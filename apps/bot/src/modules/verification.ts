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
  panelTitle: string;
  panelDescription: string;
  issueButtonLabel: string;
  confirmButtonLabel: string;
};

export class Verification implements PlatformModule {
  readonly name = "verification";
  private unsubscribe?: () => void;
  private readonly codes = new Map<string, { hash: string; expiresAt: number; attempts: number }>();

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
    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      verified_role_id: string | null;
      quarantine_role_id: string | null;
      log_channel_id: string | null;
      code_ttl_minutes: number;
      panel_title: string | null;
      panel_description: string | null;
      issue_button_label: string | null;
      confirm_button_label: string | null;
    }>(
      "SELECT enabled,channel_id,verified_role_id,quarantine_role_id,log_channel_id,code_ttl_minutes,panel_title,panel_description,issue_button_label,confirm_button_label FROM verification_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      channelId: row?.channel_id ?? null,
      verifiedRoleId: row?.verified_role_id ?? null,
      quarantineRoleId: row?.quarantine_role_id ?? null,
      logChannelId: row?.log_channel_id ?? null,
      codeTtlMinutes: row?.code_ttl_minutes ?? 10,
      panelTitle: row?.panel_title || defaultConfig.panelTitle,
      panelDescription: row?.panel_description || defaultConfig.panelDescription,
      issueButtonLabel: row?.issue_button_label || defaultConfig.issueButtonLabel,
      confirmButtonLabel: row?.confirm_button_label || defaultConfig.confirmButtonLabel
    };
  }

  async configure(guildId: string, patch: Partial<VerificationConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    const panelTitle = normalizeVerificationText(next.panelTitle, 256);
    const panelDescription = normalizeVerificationText(next.panelDescription, 4096);
    const issueButtonLabel = normalizeVerificationText(next.issueButtonLabel, 80);
    const confirmButtonLabel = normalizeVerificationText(next.confirmButtonLabel, 80);
    await this.db.query(
      `INSERT INTO verification_settings(
         guild_id,enabled,channel_id,verified_role_id,quarantine_role_id,log_channel_id,code_ttl_minutes,
         panel_title,panel_description,issue_button_label,confirm_button_label
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,verified_role_id=EXCLUDED.verified_role_id,
         quarantine_role_id=EXCLUDED.quarantine_role_id,log_channel_id=EXCLUDED.log_channel_id,
         code_ttl_minutes=EXCLUDED.code_ttl_minutes,panel_title=EXCLUDED.panel_title,
         panel_description=EXCLUDED.panel_description,issue_button_label=EXCLUDED.issue_button_label,
         confirm_button_label=EXCLUDED.confirm_button_label,updated_at=now()`,
      [
        guildId,next.enabled,next.channelId,next.verifiedRoleId,next.quarantineRoleId,next.logChannelId,
        Math.min(Math.max(next.codeTtlMinutes,2),60),panelTitle,panelDescription,issueButtonLabel,confirmButtonLabel
      ]
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
        codeTtlMinutes: interaction.options.getInteger("ttl") ?? 10,
        panelTitle: interaction.options.getString("panel-title") ?? undefined,
        panelDescription: interaction.options.getString("panel-description") ?? undefined,
        issueButtonLabel: interaction.options.getString("issue-button") ?? undefined,
        confirmButtonLabel: interaction.options.getString("confirm-button") ?? undefined
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
            .setTitle(config.panelTitle)
            .setDescription(config.panelDescription)
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("dsp:verify:issue").setLabel(config.issueButtonLabel).setStyle(ButtonStyle.Primary)
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
        new ButtonBuilder().setCustomId(`dsp:verify:confirm:${code}`).setLabel(config.confirmButtonLabel).setStyle(ButtonStyle.Success)
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


export function normalizeVerificationText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("invalid_verification_text");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error("invalid_verification_text");
  return normalized;
}
