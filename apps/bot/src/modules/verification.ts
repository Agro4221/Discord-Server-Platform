import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import crypto from "node:crypto";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { logger } from "../logger.js";
import { moduleEnabled } from "../module-utils.js";

type VerificationConfig = {
  enabled: boolean;
  channelId: string | null;
  verifiedRoleId: string | null;
  quarantineRoleId: string | null;
  logChannelId: string | null;
  codeTtlMinutes: number;
};

export class Verification implements PlatformModule {
  readonly name = "verification";
  private unsubscribe?: () => void;
  private readonly codes = new Map<string, { hash: string; expiresAt: number; attempts: number }>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("member.add", (member) => this.onJoin(member));
    const b = context.events.on("interaction.command", (interaction) => this.executeSlashCommand(interaction));
    const c = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); c(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.codes.clear();
  }

  async handlePrefixCommand(message: import("discord.js").Message, commandName: string, args: string[]): Promise<boolean> {
    if (commandName !== "verify") return false;
    if (!message.guild) return false;

    const sub = (args.shift() ?? "setup").toLowerCase();
    if (sub === "panel") {
      const channel = message.mentions.channels.first();
      const target = channel ?? message.guild.channels.cache.get(message.channelId);
      if (!target || target.type !== 0) {
        await message.reply("Укажи текстовый канал: !verify panel #канал");
        return true;
      }
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Проверка участника")
            .setDescription("Нажми кнопку, получи одноразовый код и подтверди его через кнопку ниже.")
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("dsp:verify:issue").setLabel("Получить код").setStyle(ButtonStyle.Primary)
          )
        ]
      });
      await message.reply("Панель Verification опубликована.");
      return true;
    }

    if (sub !== "setup") {
      await message.reply("Использование: !verify setup [#канал] [@verified-role] [@quarantine-role] [#log-channel] [ttl]");
      return true;
    }

    const channel = message.mentions.channels.first();
    const roleMentions = message.mentions.roles.values();
    const roles = [...roleMentions];
    const logChannel = message.mentions.channels.at(1) ?? null;
    const ttlToken = args.find((arg) => /^\d+$/.test(arg));
    const ttl = ttlToken ? Math.min(Math.max(Number(ttlToken), 2), 60) : 10;
    const [verifiedRole, quarantineRole] = roles;

    if (verifiedRole && (verifiedRole.managed || (message.guild.members.me?.roles.highest.position ?? 0) <= verifiedRole.position)) {
      await message.reply("Verified role недоступна из-за role hierarchy.");
      return true;
    }
    if (quarantineRole && (quarantineRole.managed || (message.guild.members.me?.roles.highest.position ?? 0) <= quarantineRole.position)) {
      await message.reply("Quarantine role недоступна из-за role hierarchy.");
      return true;
    }

    await this.configure(message.guild.id, {
      enabled: true,
      channelId: channel?.id ?? null,
      verifiedRoleId: verifiedRole?.id ?? null,
      quarantineRoleId: quarantineRole?.id ?? null,
      logChannelId: logChannel?.id ?? null,
      codeTtlMinutes: ttl
    });
    await message.reply("Verification настроен.");
    return true;
  }

  private async config(guildId: string): Promise<VerificationConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      verified_role_id: string | null;
      quarantine_role_id: string | null;
      log_channel_id: string | null;
      code_ttl_minutes: number;
    }>(
      "SELECT enabled,channel_id,verified_role_id,quarantine_role_id,log_channel_id,code_ttl_minutes FROM verification_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      channelId: row?.channel_id ?? null,
      verifiedRoleId: row?.verified_role_id ?? null,
      quarantineRoleId: row?.quarantine_role_id ?? null,
      logChannelId: row?.log_channel_id ?? null,
      codeTtlMinutes: row?.code_ttl_minutes ?? 10
    };
  }

  async configure(guildId: string, patch: Partial<VerificationConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO verification_settings(guild_id,enabled,channel_id,verified_role_id,quarantine_role_id,log_channel_id,code_ttl_minutes)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,verified_role_id=EXCLUDED.verified_role_id,
         quarantine_role_id=EXCLUDED.quarantine_role_id,log_channel_id=EXCLUDED.log_channel_id,
         code_ttl_minutes=EXCLUDED.code_ttl_minutes,updated_at=now()`,
      [guildId,next.enabled,next.channelId,next.verifiedRoleId,next.quarantineRoleId,next.logChannelId,Math.min(Math.max(next.codeTtlMinutes,2),60)]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'verification',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  async dashboardPublishPanel(guildId: string, channelId: string): Promise<string> {
    if (!await this.config(guildId).then((config) => config.enabled)) throw new Error("verification_disabled");
    if (!/^\d{15,25}$/.test(channelId)) throw new Error("invalid_channel");
    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    const member = guild?.members.me;
    if (!guild || !channel || channel.type !== 0) throw new Error("text_channel_required");
    if (!member?.permissions.has(PermissionFlagsBits.SendMessages) || !channel.permissionsFor(member)?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error("bot_missing_send_messages");
    }
    const message = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Проверка участника")
          .setDescription("Нажми кнопку, получи одноразовый код и подтверди его через кнопку ниже.")
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("dsp:verify:issue").setLabel("Получить код").setStyle(ButtonStyle.Primary)
        )
      ]
    });
    return message.id;
  }

  async executeSlashCommand(interaction: ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "verify") return;
    const sub = interaction.options.getSubcommand();
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (sub === "setup") {
      const channelOption = interaction.options.getChannel("channel");
      const role = interaction.options.getRole("verified-role");
      const quarantineRole = interaction.options.getRole("quarantine-role");
      const logChannelOption = interaction.options.getChannel("log-channel");
      const channel = channelOption ? interaction.guild!.channels.cache.get(channelOption.id) : null;
      const logChannel = logChannelOption ? interaction.guild!.channels.cache.get(logChannelOption.id) : null;
      if (channelOption && (!channel || !channel.isTextBased())) {
        await interaction.reply({ content: "Verification channel должен быть текстовым.", ephemeral: true });
        return;
      }
      if (logChannelOption && (!logChannel || !logChannel.isTextBased())) {
        await interaction.reply({ content: "Log channel должен быть текстовым.", ephemeral: true });
        return;
      }
      const botPosition = interaction.guild!.members.me?.roles.highest.position ?? 0;
      for (const candidate of [role, quarantineRole]) {
        if (candidate && (candidate.managed || candidate.position >= botPosition)) {
          await interaction.reply({ content: "Одна из verification-ролей недоступна из-за role hierarchy.", ephemeral: true });
          return;
        }
      }
      await this.configure(interaction.guild!.id, {
        enabled: true,
        channelId: channel?.id ?? null,
        verifiedRoleId: role?.id ?? null,
        quarantineRoleId: quarantineRole?.id ?? null,
        logChannelId: logChannel?.id ?? null,
        codeTtlMinutes: interaction.options.getInteger("ttl") ?? 10
      });
      await interaction.reply({ content: "Verification настроен.", ephemeral: true });
      return;
    }
    if (sub === "panel") {
      const channelOption = interaction.options.getChannel("channel", true);
      const channel = interaction.guild!.channels.cache.get(channelOption.id);
      if (!channel || channel.type !== 0) {
        await interaction.reply({ content: "Panel channel должен быть текстовым.", ephemeral: true });
        return;
      }
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Проверка участника")
            .setDescription("Нажми кнопку, получи одноразовый код и подтверди его через кнопку ниже.")
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("dsp:verify:issue").setLabel("Получить код").setStyle(ButtonStyle.Primary)
          )
        ]
      });
      await interaction.reply({ content: "Панель Verification опубликована.", ephemeral: true });
    }
  }

  private async onJoin(member: GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "verification", false)) return;
    const config = await this.config(member.guild.id);
    if (!config.enabled || !config.verifiedRoleId) return;
    if (member.roles.cache.has(config.verifiedRoleId)) return;

    if (config.quarantineRoleId && member.manageable) {
      const quarantineRole = member.guild.roles.cache.get(config.quarantineRoleId);
      const bot = member.guild.members.me;
      if (quarantineRole && bot?.permissions.has(PermissionFlagsBits.ManageRoles) &&
          !quarantineRole.managed && quarantineRole.position < bot.roles.highest.position) {
        await member.roles.add(quarantineRole, "Verification quarantine").catch((error) => {
          logger.warn("Verification quarantine role assignment failed", {
            guildId: member.guild.id,
            userId: member.id,
            roleId: quarantineRole.id,
            error: String(error)
          });
        });
      }
    }

    if (config.logChannelId) {
      const channel = member.guild.channels.cache.get(config.logChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send("🛂 Verification: новый участник ожидает подтверждения — <@" + member.id + ">").catch((error) => {
          logger.warn("Verification pending notification failed", {
            guildId: member.guild.id,
            channelId: channel.id,
            userId: member.id,
            error: String(error)
          });
        });
      }
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.guild!) return;
    if (interaction.customId === "dsp:verify:issue") {
      await this.issue(interaction);
      return;
    }
    if (interaction.customId.startsWith("dsp:verify:confirm:")) {
      await this.confirm(interaction, interaction.customId.slice("dsp:verify:confirm:".length));
    }
  }

  private async issue(interaction: import("discord.js").ButtonInteraction): Promise<void> {
    const config = await this.config(interaction.guild!.id);
    if (!config.enabled) {
      await interaction.reply({ content: "Verification выключен.", ephemeral: true });
      return;
    }
    const key = interaction.guild!.id + ":" + interaction.user.id;
    this.pruneCodes(Date.now());
    const existing = this.codes.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      await interaction.reply({ content: "У тебя уже есть действующий код. Используй его с кнопкой подтверждения.", ephemeral: true });
      return;
    }
    const code = crypto.randomInt(100000, 1_000_000).toString();
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = Date.now() + config.codeTtlMinutes * 60_000;
    this.codes.set(key, { hash, expiresAt, attempts: 0 });
    try {
      await interaction.reply({
      content: `Твой одноразовый код: **${code}**`,
      ephemeral: true,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`dsp:verify:confirm:${code}`).setLabel("Подтвердить").setStyle(ButtonStyle.Success)
      )]
      });
    } catch (error) {
      this.codes.delete(key);
      logger.warn("Verification code issue reply failed", {
        guildId: interaction.guild!.id,
        userId: interaction.user.id,
        error: String(error)
      });
      throw error;
    }
  }

  private pruneCodes(now: number): void {
    for (const [key, value] of this.codes) {
      if (value.expiresAt <= now) this.codes.delete(key);
    }

    const maxCodes = 10_000;
    if (this.codes.size <= maxCodes) return;

    const oldest = [...this.codes.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, this.codes.size - maxCodes);
    for (const [key] of oldest) this.codes.delete(key);

    logger.warn("Verification code cache trimmed", {
      removed: oldest.length,
      remaining: this.codes.size
    });
  }

  private async confirm(interaction: import("discord.js").ButtonInteraction, code: string): Promise<void> {
    const key = `${interaction.guild!.id}:${interaction.user.id}`;
    const entry = this.codes.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(key);
      await interaction.reply({ content: "Код истёк. Получи новый.", ephemeral: true });
      return;
    }
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const expected = Buffer.from(entry.hash, "hex");
    const provided = Buffer.from(hash, "hex");
    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      entry.attempts += 1;
      if (entry.attempts >= 5) {
        this.codes.delete(key);
        await interaction.reply({ content: "Слишком много неверных попыток. Получи новый код.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: `Неверный код. Осталось попыток: ${5 - entry.attempts}.`, ephemeral: true });
      return;
    }
    const config = await this.config(interaction.guild!.id);
    const role = config.verifiedRoleId ? interaction.guild!.roles.cache.get(config.verifiedRoleId) : null;
    const member = await interaction.guild!.members.fetch(interaction.user.id);
    if (!role || role.position >= (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
      await interaction.reply({ content: "Verification role недоступна для бота.", ephemeral: true });
      return;
    }
    await member.roles.add(role, "Verification");
    if (config.quarantineRoleId && member.roles.cache.has(config.quarantineRoleId)) {
      const quarantineRole = interaction.guild!.roles.cache.get(config.quarantineRoleId);
      if (quarantineRole && quarantineRole.position < (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
        await member.roles.remove(quarantineRole, "Verification passed").catch((error) => {
          logger.warn("Verification quarantine removal failed", {
            guildId: interaction.guild!.id,
            userId: interaction.user.id,
            roleId: quarantineRole.id,
            error: String(error)
          });
        });
      }
    }
    this.codes.delete(key);
    await interaction.reply({ content: "✅ Проверка пройдена.", ephemeral: true });
    if (config.logChannelId) {
      const channel = interaction.guild!.channels.cache.get(config.logChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send(`✅ Verification: ${interaction.user.tag} подтвердил аккаунт.`).catch((error) => {
          logger.warn("Verification success notification failed", {
            guildId: interaction.guild!.id,
            channelId: channel.id,
            userId: interaction.user.id,
            error: String(error)
          });
        });
      }
    }
  }
}
