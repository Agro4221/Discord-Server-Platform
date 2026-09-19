import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type SecurityConfig = {
  enabled: boolean;
  maxJoins: number;
  windowSeconds: number;
  maxDestructiveActions: number;
  destructiveWindowSeconds: number;
  quarantineRoleId: string | null;
  logChannelId: string | null;
};

export class Security implements PlatformModule {
  readonly name = "security";
  private unsubscribe?: () => void;
  private readonly joins = new Map<string, number[]>();
  private readonly raidActiveUntil = new Map<string, number>();
  private readonly alertAt = new Map<string, number>();
  private readonly destructive = new Map<string, number[]>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("member.add", (member) => this.onJoin(member));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const c = context.events.on("channel.delete", (channel) => this.onDestructive(channel.guildId, "channel.delete"));
    const d = context.events.on("role.delete", (role) => this.onDestructive(role.guild.id, "role.delete"));
    this.unsubscribe = () => { a(); b(); c(); d(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.joins.clear();
    this.raidActiveUntil.clear();
    this.alertAt.clear();
    this.destructive.clear();
  }

  private async config(guildId: string): Promise<SecurityConfig> {
    const result = await this.db.query<{ enabled: boolean; max_joins: number; window_seconds: number; max_destructive_actions: number; destructive_window_seconds: number; quarantine_role_id: string | null; log_channel_id: string | null }>(
      "SELECT enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id FROM security_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      maxJoins: row?.max_joins ?? 10,
      windowSeconds: row?.window_seconds ?? 20,
      maxDestructiveActions: row?.max_destructive_actions ?? 5,
      destructiveWindowSeconds: row?.destructive_window_seconds ?? 20,
      quarantineRoleId: row?.quarantine_role_id ?? null,
      logChannelId: row?.log_channel_id ?? null
    };
  }

  async configure(guildId: string, patch: Partial<SecurityConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO security_settings(guild_id,enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,max_joins=EXCLUDED.max_joins,window_seconds=EXCLUDED.window_seconds,
       max_destructive_actions=EXCLUDED.max_destructive_actions,destructive_window_seconds=EXCLUDED.destructive_window_seconds,
       quarantine_role_id=EXCLUDED.quarantine_role_id,log_channel_id=EXCLUDED.log_channel_id,updated_at=now()`,
      [guildId,next.enabled,Math.min(Math.max(next.maxJoins,2),200),Math.min(Math.max(next.windowSeconds,5),300),
       Math.min(Math.max(next.maxDestructiveActions,2),100),Math.min(Math.max(next.destructiveWindowSeconds,5),300),
       next.quarantineRoleId,next.logChannelId]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'security',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "security") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "setup") return;
    const logChannel = interaction.options.getChannel("log-channel");
    if (logChannel && !logChannel.isTextBased()) {
      await interaction.reply({ content: "Security log channel должен быть текстовым.", ephemeral: true });
      return;
    }
    await this.configure(interaction.guild.id, {
      enabled: true,
      maxJoins: interaction.options.getInteger("max-joins", true),
      windowSeconds: interaction.options.getInteger("window", true),
      maxDestructiveActions: interaction.options.getInteger("max-destructive") ?? 5,
      destructiveWindowSeconds: interaction.options.getInteger("destructive-window") ?? 20,
      quarantineRoleId: interaction.options.getRole("quarantine-role")?.id ?? null,
      logChannelId: logChannel?.id ?? null
    });
    await interaction.reply({ content: "Security настроен и включён.", ephemeral: true });
  }

  private async onJoin(member: GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "security", false)) return;
    const config = await this.config(member.guild.id);
    if (!config.enabled) return;
    const now = Date.now();
    const cutoff = now - config.windowSeconds * 1000;
    const bucket = (this.joins.get(member.guild.id) ?? []).filter((timestamp) => timestamp >= cutoff);
    bucket.push(now);
    this.joins.set(member.guild.id, bucket);
    const activeUntil = this.raidActiveUntil.get(member.guild.id) ?? 0;
    const raidTriggered = bucket.length >= config.maxJoins;
    if (!raidTriggered && now < activeUntil) { await this.quarantine(member, config); return; }
    if (!raidTriggered) return;
    this.raidActiveUntil.set(member.guild.id, now + Math.max(config.windowSeconds * 1000, 60000));
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'raid-detected',$2::jsonb)",
      [member.guild.id,JSON.stringify({ joins: bucket.length, windowSeconds: config.windowSeconds })]
    );
    await this.quarantine(member, config);
    await this.alert(member.guild.id, config, `Anti-Raid: ${bucket.length} входов за ${config.windowSeconds} сек.`);
  }

  private async onDestructive(guildId: string | null, type: string): Promise<void> {
    if (!guildId || !await moduleEnabled(this.db, guildId, "security", false)) return;
    const config = await this.config(guildId);
    if (!config.enabled) return;
    const now = Date.now();
    const cutoff = now - config.destructiveWindowSeconds * 1000;
    const bucket = (this.destructive.get(guildId) ?? []).filter((timestamp) => timestamp >= cutoff);
    bucket.push(now);
    this.destructive.set(guildId, bucket);
    if (bucket.length < config.maxDestructiveActions) return;
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'destructive-burst',$2::jsonb)",
      [guildId,JSON.stringify({ type, actions: bucket.length, windowSeconds: config.destructiveWindowSeconds })]
    );
    await this.alert(guildId, config, `Security: обнаружено ${bucket.length} destructive actions за ${config.destructiveWindowSeconds} сек.`);
  }

  private async alert(guildId: string, config: SecurityConfig, message: string): Promise<void> {
    const now = Date.now();
    const last = this.alertAt.get(guildId) ?? 0;
    if (!config.logChannelId || now - last < 60000) return;
    this.alertAt.set(guildId, now);
    const guild = [...(globalThis.__DSP_GUILDS ?? [])].find((item) => item.id === guildId);
    const channel = guild?.channels.cache.get(config.logChannelId);
    if (channel?.isTextBased() && "send" in channel) await (channel as TextChannel).send("🚨 " + message).catch(() => undefined);
  }

  private async quarantine(member: GuildMember, config: SecurityConfig): Promise<void> {
    if (!config.quarantineRoleId || !member.manageable) return;
    const botMember = member.guild.members.me;
    const role = member.guild.roles.cache.get(config.quarantineRoleId);
    if (!botMember || !role || role.position >= botMember.roles.highest.position) return;
    await member.roles.add(role, "Security anti-raid quarantine").catch(() => undefined);
  }
}

declare global {
  var __DSP_GUILDS: Iterable<import("discord.js").Guild> | undefined;
}
