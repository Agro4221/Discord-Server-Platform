import {
  AuditLogEvent,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { logger } from "../logger.js";
import { moduleEnabled } from "../module-utils.js";

export type SecurityConfig = {
  enabled: boolean;
  maxJoins: number;
  windowSeconds: number;
  maxDestructiveActions: number;
  destructiveWindowSeconds: number;
  quarantineRoleId: string | null;
  logChannelId: string | null;
  raidQuarantineEnabled: boolean;
  destructiveRoleRemoval: boolean;
  destructiveQuarantineEnabled: boolean;
};

export class Security implements PlatformModule {
  readonly name = "security";
  private unsubscribe?: () => void;
  private readonly joins = new Map<string, { timestamp: number; userId: string }[]>();
  private readonly raidActiveUntil = new Map<string, number>();
  private readonly destructiveActiveUntil = new Map<string, number>();
  private readonly alertAt = new Map<string, number>();
  private readonly destructive = new Map<string, { timestamp: number; type: string }[]>();
  private client?: import("discord.js").Client;
  private auditLog?: import("../audit.js").AuditLog;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;
    await this.restoreActiveIncidents();
    const a = context.events.on("member.add", (member) => this.onJoin(member));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const c = context.events.on("channel.delete", (channel) => this.onDestructive(channel.guildId, "channel.delete"));
    const d = context.events.on("role.delete", (role) => this.onDestructive(role.guild.id, "role.delete"));
    const e = context.events.on("member.ban", ({ guildId, userId }) => this.onDestructive(guildId, "member.ban", userId));
    this.unsubscribe = () => { a(); b(); c(); d(); e(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.joins.clear();
    this.raidActiveUntil.clear();
    this.destructiveActiveUntil.clear();
    this.alertAt.clear();
    this.destructive.clear();
    this.auditLog = undefined;
    this.client = undefined;
  }

  async getConfig(guildId: string): Promise<SecurityConfig> {
    const result = await this.db.query<{ enabled: boolean; max_joins: number; window_seconds: number; max_destructive_actions: number; destructive_window_seconds: number; quarantine_role_id: string | null; log_channel_id: string | null; raid_quarantine_enabled: boolean; destructive_role_removal: boolean; destructive_quarantine_enabled: boolean }>(
      "SELECT enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id,raid_quarantine_enabled,destructive_role_removal,destructive_quarantine_enabled FROM security_settings WHERE guild_id=$1",
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
      logChannelId: row?.log_channel_id ?? null,
      ...securityResponsePolicy({
        raidQuarantineEnabled: row?.raid_quarantine_enabled,
        destructiveRoleRemoval: row?.destructive_role_removal,
        destructiveQuarantineEnabled: row?.destructive_quarantine_enabled
      })
    };
  }

  async configure(guildId: string, patch: Partial<SecurityConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO security_settings(guild_id,enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id,raid_quarantine_enabled,destructive_role_removal,destructive_quarantine_enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,max_joins=EXCLUDED.max_joins,window_seconds=EXCLUDED.window_seconds,
       max_destructive_actions=EXCLUDED.max_destructive_actions,destructive_window_seconds=EXCLUDED.destructive_window_seconds,
       quarantine_role_id=EXCLUDED.quarantine_role_id,log_channel_id=EXCLUDED.log_channel_id,
       raid_quarantine_enabled=EXCLUDED.raid_quarantine_enabled,destructive_role_removal=EXCLUDED.destructive_role_removal,
       destructive_quarantine_enabled=EXCLUDED.destructive_quarantine_enabled,updated_at=now()`,
      [guildId,next.enabled,Math.min(Math.max(next.maxJoins,2),200),Math.min(Math.max(next.windowSeconds,5),300),
       Math.min(Math.max(next.maxDestructiveActions,2),100),Math.min(Math.max(next.destructiveWindowSeconds,5),300),
       next.quarantineRoleId,next.logChannelId,next.raidQuarantineEnabled,next.destructiveRoleRemoval,next.destructiveQuarantineEnabled]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'security',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  private async restoreActiveIncidents(): Promise<void> {
    const result = await this.db.query<{
      guild_id: string;
      event_type: "raid-detected" | "destructive-burst";
      created_at: Date | string;
      metadata: { windowSeconds?: number };
    }>(
      "SELECT guild_id,event_type,created_at,metadata FROM security_events WHERE event_type IN ('raid-detected','destructive-burst') AND created_at >= now() - interval '5 minutes' ORDER BY created_at DESC LIMIT 10000"
    );

    const now = Date.now();
    for (const row of result.rows) {
      const createdAt = new Date(row.created_at).getTime();
      if (!Number.isFinite(createdAt)) continue;

      const configuredWindowSeconds =
        typeof row.metadata?.windowSeconds === "number" && Number.isFinite(row.metadata.windowSeconds)
          ? row.metadata.windowSeconds
          : 20;
      const cooldown = securityIncidentCooldownUntil(createdAt, configuredWindowSeconds);
      if (cooldown <= now) continue;

      if (row.event_type === "raid-detected") {
        const current = this.raidActiveUntil.get(row.guild_id) ?? 0;
        if (cooldown > current) this.raidActiveUntil.set(row.guild_id, cooldown);
      } else {
        const current = this.destructiveActiveUntil.get(row.guild_id) ?? 0;
        if (cooldown > current) this.destructiveActiveUntil.set(row.guild_id, cooldown);
      }
    }
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "security") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "status") {
      const config = await this.config(interaction.guild!.id);
      const now = Date.now();
      const raidUntil = this.raidActiveUntil.get(interaction.guild!.id) ?? 0;
      const destructiveUntil = this.destructiveActiveUntil.get(interaction.guild!.id) ?? 0;
      const joins = this.joins.get(interaction.guild!.id) ?? [];
      const destructive = this.destructive.get(interaction.guild!.id) ?? [];
      await interaction.reply({
        content: [
          "🛡️ **Security status**",
          `Модуль: **${config.enabled ? "включён" : "выключен"}**`,
          `Anti-Raid: **${joins.length}/${config.maxJoins}** за ${config.windowSeconds} сек. · ${raidUntil > now ? "🚨 активен" : "✅ не активен"}`,
          `Destructive: **${destructive.length}/${config.maxDestructiveActions}** за ${config.destructiveWindowSeconds} сек. · ${destructiveUntil > now ? "🚨 активен" : "✅ не активен"}`,
          `Quarantine role: ${config.quarantineRoleId ? "<@&" + config.quarantineRoleId + ">" : "не настроена"}`,
          `Log channel: ${config.logChannelId ? "<#" + config.logChannelId + ">" : "не настроен"}`,
          `Responses: Anti-Raid quarantine=${config.raidQuarantineEnabled ? "on" : "off"} · destructive roles=${config.destructiveRoleRemoval ? "on" : "off"} · destructive quarantine=${config.destructiveQuarantineEnabled ? "on" : "off"}`
        ].join("\n"),
        ephemeral: true
      });
      return;
    }

    if (sub !== "setup") return;
    const logChannelOption = interaction.options.getChannel("log-channel");
    const logChannel = logChannelOption ? interaction.guild!.channels.cache.get(logChannelOption.id) : null;
    if (logChannelOption && (!logChannel || logChannel.type !== 0)) {
      await interaction.reply({ content: "Security log channel должен быть текстовым.", ephemeral: true });
      return;
    }
    await this.configure(interaction.guild!.id, {
      enabled: true,
      maxJoins: interaction.options.getInteger("max-joins", true),
      windowSeconds: interaction.options.getInteger("window", true),
      maxDestructiveActions: interaction.options.getInteger("max-destructive") ?? 5,
      destructiveWindowSeconds: interaction.options.getInteger("destructive-window") ?? 20,
      quarantineRoleId: interaction.options.getRole("quarantine-role")?.id ?? null,
      logChannelId: logChannel?.id ?? null,
      raidQuarantineEnabled: interaction.options.getBoolean("raid-quarantine") ?? true,
      destructiveRoleRemoval: interaction.options.getBoolean("destructive-role-removal") ?? true,
      destructiveQuarantineEnabled: interaction.options.getBoolean("destructive-quarantine") ?? true
    });
    await interaction.reply({ content: "Security настроен и включён.", ephemeral: true });
  }

  private async onJoin(member: GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "security", false)) return;
    const config = await this.config(member.guild.id);
    if (!config.enabled) return;
    const now = Date.now();
    const cutoff = now - config.windowSeconds * 1000;
    const bucket = (this.joins.get(member.guild.id) ?? []).filter((entry) => entry.timestamp >= cutoff);
    bucket.push({ timestamp: now, userId: member.id });
    this.joins.set(member.guild.id, bucket);
    this.pruneBuckets(now);
    const activeUntil = this.raidActiveUntil.get(member.guild.id) ?? 0;
    const raidTriggered = bucket.length >= config.maxJoins;
    if (now < activeUntil) {
      if (config.raidQuarantineEnabled) await this.quarantine(member, config);
      return;
    }
    if (!raidTriggered) return;

    this.raidActiveUntil.set(member.guild.id, now + Math.max(config.windowSeconds * 1000, 60000));
    const raidMetadata = { joins: bucket.length, windowSeconds: config.windowSeconds };
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'raid-detected',$2::jsonb)",
      [member.guild.id,JSON.stringify(raidMetadata)]
    );
    await this.audit(
      member.guild.id,
      "security.raid-detected",
      raidMetadata
    );
    for (const entry of bucket) {
      const target = member.guild.members.cache.get(entry.userId) ?? await member.guild.members.fetch(entry.userId).catch(() => null);
      if (target && config.raidQuarantineEnabled) await this.quarantine(target, config);
    }
    await this.alert(member.guild.id, config, `Anti-Raid: ${bucket.length} входов за ${config.windowSeconds} сек.`);
  }

  private async onDestructive(guildId: string | null, type: string, targetUserId?: string): Promise<void> {
    if (!guildId || !await moduleEnabled(this.db, guildId, "security", false)) return;
    const config = await this.getConfig(guildId);
    if (!config.enabled) return;
    const now = Date.now();
    const cutoff = now - config.destructiveWindowSeconds * 1000;
    const bucket = (this.destructive.get(guildId) ?? []).filter((entry) => entry.timestamp >= cutoff);
    bucket.push({ timestamp: now, type });
    this.destructive.set(guildId, bucket);
    this.pruneBuckets(now);
    const activeUntil = this.destructiveActiveUntil.get(guildId) ?? 0;
    if (!shouldTriggerSecurityIncident(now, activeUntil, bucket.length, config.maxDestructiveActions)) return;

    this.destructiveActiveUntil.set(
      guildId,
      now + Math.max(config.destructiveWindowSeconds * 1000, 60000)
    );
    const burstMetadata = { type, actions: bucket.length, windowSeconds: config.destructiveWindowSeconds };
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'destructive-burst',$2::jsonb)",
      [guildId,JSON.stringify(burstMetadata)]
    );
    await this.audit(guildId, "security.destructive-burst", burstMetadata);
    const executors = await this.findRecentExecutors(guildId, type, targetUserId, config.destructiveWindowSeconds);
    for (const executor of executors) {
      await this.respondToExecutor(guildId, executor.userId, config, type, executor.count);
    }
    await this.alert(guildId, config, `Security: обнаружено ${bucket.length} destructive actions за ${config.destructiveWindowSeconds} сек.`);
  }

  async checkHierarchy(guildId: string): Promise<{
    guildId: string;
    botPresent: boolean;
    manageRoles: boolean;
    quarantineRoleConfigured: boolean;
    quarantineRoleManageable: boolean;
    logChannelConfigured: boolean;
    logChannelSendable: boolean;
  }> {
    const config = await this.config(guildId);
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) {
      return {
        guildId,
        botPresent: false,
        manageRoles: false,
        quarantineRoleConfigured: Boolean(config.quarantineRoleId),
        quarantineRoleManageable: false,
        logChannelConfigured: Boolean(config.logChannelId),
        logChannelSendable: false
      };
    }

    const botMember = guild.members.me;
    const quarantineRole = config.quarantineRoleId ? guild.roles.cache.get(config.quarantineRoleId) : null;
    const logChannel = config.logChannelId ? guild.channels.cache.get(config.logChannelId) : null;
    const logPermissions =
      botMember && logChannel && "permissionsFor" in logChannel
        ? logChannel.permissionsFor(botMember)
        : null;

    return {
      guildId,
      botPresent: Boolean(botMember),
      manageRoles: Boolean(botMember?.permissions.has(PermissionFlagsBits.ManageRoles)),
      quarantineRoleConfigured: Boolean(config.quarantineRoleId),
      quarantineRoleManageable: Boolean(
        botMember &&
        quarantineRole &&
        botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
        quarantineRole.position < botMember.roles.highest.position
      ),
      logChannelConfigured: Boolean(config.logChannelId),
      logChannelSendable: Boolean(
        logChannel?.isTextBased() &&
        logPermissions?.has(PermissionFlagsBits.ViewChannel) &&
        logPermissions.has(PermissionFlagsBits.SendMessages)
      )
    };
  }

  private pruneBuckets(now: number): void {
    const cutoff = now - 300_000;
    for (const [guildId, entries] of this.joins) {
      const latest = entries.at(-1)?.timestamp ?? 0;
      if (latest < cutoff) this.joins.delete(guildId);
    }
    for (const [guildId, entries] of this.destructive) {
      const latest = entries.at(-1)?.timestamp ?? 0;
      if (latest < cutoff) this.destructive.delete(guildId);
    }

    for (const [guildId, until] of this.raidActiveUntil) {
      if (until <= now) this.raidActiveUntil.delete(guildId);
    }
    for (const [guildId, until] of this.destructiveActiveUntil) {
      if (until <= now) this.destructiveActiveUntil.delete(guildId);
    }
    for (const [guildId, at] of this.alertAt) {
      if (at <= now - 60_000) this.alertAt.delete(guildId);
    }

    const maxGuilds = 10_000;
    for (const [name, bucket] of [
      ["joins", this.joins],
      ["destructive", this.destructive]
    ] as const) {
      if (bucket.size <= maxGuilds) continue;
      const oldest = [...bucket.entries()]
        .sort((a, b) => (a[1].at(-1)?.timestamp ?? 0) - (b[1].at(-1)?.timestamp ?? 0))
        .slice(0, bucket.size - maxGuilds);
      for (const [guildId] of oldest) bucket.delete(guildId);
      logger.warn("Security event cache trimmed", { name, removed: oldest.length, remaining: bucket.size });
    }
  }

  private async audit(
    guildId: string,
    action: string,
    metadata: Record<string, unknown>,
    targetType?: string,
    targetId?: string
  ): Promise<void> {
    try {
      await this.auditLog?.record({
        guildId,
        source: "system",
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        metadata
      });
    } catch (error) {
      logger.warn("Security audit write failed", { guildId, action, error: String(error) });
    }
  }

  private async alert(guildId: string, config: SecurityConfig, message: string): Promise<void> {
    const now = Date.now();
    const last = this.alertAt.get(guildId) ?? 0;
    if (!config.logChannelId || now - last < 60000) return;
    this.alertAt.set(guildId, now);
    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(config.logChannelId);
    if (channel?.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send("🚨 " + message).catch((error) => {
        logger.warn("Security alert delivery failed", { guildId, channelId: config.logChannelId, error: String(error) });
      });
    }
  }

  private async quarantine(member: GuildMember, config: SecurityConfig): Promise<void> {
    if (
      !config.quarantineRoleId ||
      !member.manageable ||
      member.id === member.guild.ownerId ||
      member.permissions.has(PermissionFlagsBits.Administrator)
    ) return;
    const botMember = member.guild.members.me;
    const role = member.guild.roles.cache.get(config.quarantineRoleId);
    if (!botMember || !role || role.position >= botMember.roles.highest.position) return;
    await member.roles.add(role, "Security quarantine").catch((error) => {
      logger.warn("Security quarantine role assignment failed", {
        guildId: member.guild.id,
        userId: member.id,
        roleId: role.id,
        error: String(error)
      });
    });
  }

  private async findRecentExecutors(
    guildId: string,
    type: string,
    targetUserId?: string,
    windowSeconds = 20
  ): Promise<Array<{ userId: string; count: number }>> {
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) return [];
    await new Promise((resolve) => setTimeout(resolve, 350));

    const auditType =
      type === "channel.delete" ? AuditLogEvent.ChannelDelete :
      type === "role.delete" ? AuditLogEvent.RoleDelete :
      AuditLogEvent.MemberBanAdd;
    const logs = await guild.fetchAuditLogs({ limit: 25, type: auditType }).catch((error) => {
      logger.warn("Security audit-log fetch failed", { guildId, type, error: String(error) });
      return null;
    });
    if (!logs) return [];

    const cutoff = securityAuditLookbackCutoff(Date.now(), windowSeconds);
    const counts = new Map<string, number>();
    for (const entry of logs.entries.values()) {
      if (entry.createdTimestamp < cutoff || !entry.executorId) continue;
      if (entry.executorId === guild.members.me?.id) continue;
      if (type === "member.ban" && targetUserId && entry.targetId !== targetUserId) continue;
      counts.set(entry.executorId, (counts.get(entry.executorId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([userId, count]) => ({ userId, count }));
  }

  private async respondToExecutor(guildId: string, userId: string, config: SecurityConfig, type: string, executorCount: number): Promise<void> {
    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (
      !guild ||
      !member ||
      !member.manageable ||
      member.id === guild.ownerId ||
      member.permissions.has(PermissionFlagsBits.Administrator)
    ) return;
    const botMember = guild.members.me;
    if (!botMember) return;

    const responseThreshold = securityResponseThreshold(config.maxDestructiveActions);
    const removable = config.destructiveRoleRemoval && executorCount >= responseThreshold &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
      ? member.roles.cache.filter(
          (role) => !role.managed && role.id !== guild.id && role.position < botMember.roles.highest.position
        )
      : member.roles.cache.filter(() => false);
    for (const role of removable.values()) {
      await member.roles.remove(role, "Security destructive burst response").catch((error) => {
        logger.warn("Security role removal failed", {
          guildId,
          userId,
          roleId: role.id,
          error: String(error)
        });
      });
    }

    if (config.destructiveQuarantineEnabled) await this.quarantine(member, config);

    const responseMetadata = {
      userId,
      trigger: type,
      executorCount,
      removedRoles: removable.size,
      quarantine: config.destructiveQuarantineEnabled && Boolean(config.quarantineRoleId)
    };
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'response-applied',$2::jsonb)",
      [guildId,JSON.stringify(responseMetadata)]
    );
    await this.audit(
      guildId,
      "security.response-applied",
      responseMetadata,
      "user",
      userId
    );
  }
}

export function shouldTriggerSecurityIncident(
  now: number,
  activeUntil: number,
  count: number,
  threshold: number
): boolean {
  return count >= threshold && now >= activeUntil;
}

export function securityIncidentCooldownUntil(createdAt: number, windowSeconds: number): number {
  return createdAt + Math.max(windowSeconds * 1000, 60_000);
}

export function securityResponsePolicy(input: Partial<{ raidQuarantineEnabled: boolean; destructiveRoleRemoval: boolean; destructiveQuarantineEnabled: boolean }>): { raidQuarantineEnabled: boolean; destructiveRoleRemoval: boolean; destructiveQuarantineEnabled: boolean } {
  return {
    raidQuarantineEnabled: input.raidQuarantineEnabled ?? true,
    destructiveRoleRemoval: input.destructiveRoleRemoval ?? true,
    destructiveQuarantineEnabled: input.destructiveQuarantineEnabled ?? true
  };
}

export function securityResponseThreshold(maxDestructiveActions: number): number {
  return Math.max(2, Math.ceil(maxDestructiveActions / 2));
}

export function securityAuditLookbackCutoff(now: number, windowSeconds: number): number {
  return now - Math.min(Math.max(windowSeconds, 5), 300) * 1000;
}
