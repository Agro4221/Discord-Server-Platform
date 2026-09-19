import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import crypto from "node:crypto";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type VerificationConfig = {
  enabled: boolean;
  channelId: string | null;
  verifiedRoleId: string | null;
  logChannelId: string | null;
  codeTtlMinutes: number;
};

export class Verification implements PlatformModule {
  readonly name = "verification";
  private unsubscribe?: () => void;
  private readonly codes = new Map<string, { hash: string; expiresAt: number }>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("member.add", (member) => this.onJoin(member));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const c = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); c(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.codes.clear();
  }

  private async config(guildId: string): Promise<VerificationConfig> {
    const result = await this.db.query<{ enabled: boolean; channel_id: string | null; verified_role_id: string | null; log_channel_id: string | null; code_ttl_minutes: number }>(
      "SELECT enabled,channel_id,verified_role_id,log_channel_id,code_ttl_minutes FROM verification_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      channelId: row?.channel_id ?? null,
      verifiedRoleId: row?.verified_role_id ?? null,
      logChannelId: row?.log_channel_id ?? null,
      codeTtlMinutes: row?.code_ttl_minutes ?? 10
    };
  }

  async configure(guildId: string, patch: Partial<VerificationConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO verification_settings(guild_id,enabled,channel_id,verified_role_id,log_channel_id,code_ttl_minutes)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,verified_role_id=EXCLUDED.verified_role_id,
         log_channel_id=EXCLUDED.log_channel_id,code_ttl_minutes=EXCLUDED.code_ttl_minutes,updated_at=now()`,
      [guildId,next.enabled,next.channelId,next.verifiedRoleId,next.logChannelId,Math.min(Math.max(next.codeTtlMinutes,2),60)]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'verification',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "verify") return;
    const sub = interaction.options.getSubcommand();
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (sub === "setup") {
      const channelOption = interaction.options.getChannel("channel");
      const role = interaction.options.getRole("verified-role");
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
      await this.configure(interaction.guild!.id, {
        enabled: true,
        channelId: channel?.id ?? null,
        verifiedRoleId: role?.id ?? null,
        logChannelId: logChannel?.id ?? null,
        codeTtlMinutes: interaction.options.getInteger("ttl") ?? 10
      });
      await interaction.reply({ content: "Verification настроен.", ephemeral: true });
      return;
    }
    if (sub === "panel") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased() || !("send" in channel)) {
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
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.guild) return;
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
    const key = `${interaction.guild!.id}:${interaction.user.id}`;
    const existing = this.codes.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      await interaction.reply({ content: "У тебя уже есть действующий код. Используй его с кнопкой подтверждения.", ephemeral: true });
      return;
    }
    const code = crypto.randomInt(100000, 1_000_000).toString();
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = Date.now() + config.codeTtlMinutes * 60_000;
    this.codes.set(key, { hash, expiresAt });
    await interaction.reply({
      content: `Твой одноразовый код: **${code}**`,
      ephemeral: true,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`dsp:verify:confirm:${code}`).setLabel("Подтвердить").setStyle(ButtonStyle.Success)
      )]
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
    if (hash !== entry.hash) {
      await interaction.reply({ content: "Неверный код.", ephemeral: true });
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
    this.codes.delete(key);
    await interaction.reply({ content: "✅ Проверка пройдена.", ephemeral: true });
    if (config.logChannelId) {
      const channel = interaction.guild!.channels.cache.get(config.logChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        await channel.send(`✅ Verification: ${interaction.user.tag} подтвердил аккаунт.`).catch(() => undefined);
      }
    }
  }
}
