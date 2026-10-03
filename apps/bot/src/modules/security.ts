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

type SecurityConfig = {
  enabled: boolean;
  maxJoins: number;
  windowSeconds: number;
  maxDestructiveActions: number;
  destructiveWindowSeconds: number;
  quarantineRoleId: string | null;
  logChannelId: string | null;
  incidentDurationSeconds: number;
  autoQuarantine: boolean;
  removeExecutorRoles: boolean;
};

export class Security implements PlatformModule {
  readonly name = "security";
  private unsubscribe?: () => void;
  private readonly joins = new Map<string, { timestamp: number; userId: string }[]>();
  private readonly raidIncidents = new Map<string, { id: number; expiresAt: number }>();
  private readonly destructiveIncidents = new Map<string, { id: number; expiresAt: number }>();
  private readonly alertAt = new Map<string, number>();
  private readonly destructive = new Map<string, { timestamp: number; type: string }[]>();
  private client?: import("discord.js").Client;
  private auditLog?: import("../audit.js").AuditLog;
  private incidentTimer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;
    await this.restoreActiveIncidents();
    await this.sweepIncidents();
    this.incidentTimer = setInterval(() => void this.sweepIncidents(), 15_000);
    this.incidentTimer.unref();
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
    this.raidIncidents.clear();
    this.destructiveIncidents.clear();
    this.alertAt.clear();
    this.destructive.clear();
    if (this.incidentTimer) clearInterval(this.incidentTimer);
    this.incidentTimer = undefined;
    this.auditLog = undefined;
    this.client = undefined;
  }

  async handlePrefixCommand(message: import("discord.js").Message, commandName: string, args: string[]): Promise<boolean> {
    if (commandName !== "security") return false;
    if (!message.guild) return false;

    const sub = (args.shift() ?? "setup").toLowerCase();
    if (sub !== "setup") {
      await message.reply("Использование: !security setup <max-joins> <window> [max-destructive] [destructive-window] [@quarantine-role] [#log-channel]");
      return true;
    }

    const numeric = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
    const maxJoins = numeric[0];
    const windowSeconds = numeric[1];
    if (!Number.isFinite(maxJoins) || !Number.isFinite(windowSeconds)) {
      await message.reply("Пример: !security setup 10 20 5 20 @Quarantine #security-log");
      return true;
    }

    const roles = [...message.mentions.roles.values()];
    const channels = [...message.mentions.channels.values()];
    const botPosition = message.guild.members.me?.roles.highest.position ?? 0;
    const quarantineRole = roles[0] ?? null;
    if (quarantineRole && (quarantineRole.managed || quarantineRole.position >= botPosition)) {
      await message.reply("Quarantine role недоступна из-за role hierarchy.");
      return true;
    }

    await this.configure(message.guild.id, {
      enabled: true,
      maxJoins,
      windowSeconds,
      maxDestructiveActions: numeric[2] ?? 5,
      destructiveWindowSeconds: numeric[3] ?? 20,
      quarantineRoleId: quarantineRole?.id ?? null,
      logChannelId: channels[0]?.id ?? null
    });
    await message.reply("Security настроен и включён.");
    return true;
  }

  private async config(guildId: string): Promise<SecurityConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      max_joins: number;
      window_seconds: number;
      max_destructive_actions: number;
      destructive_window_seconds: number;
      quarantine_role_id: string | null;
      log_channel_id: string | null;
      incident_duration_seconds: number;
      auto_quarantine: boolean;
      remove_executor_roles: boolean;
    }>(
      "SELECT enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id,incident_duration_seconds,auto_quarantine,remove_executor_roles FROM security_settings WHERE guild_id=$1",
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
      incidentDurationSeconds: row?.incident_duration_seconds ?? 300,
      autoQuarantine: row?.auto_quarantine ?? true,
      removeExecutorRoles: row?.remove_executor_roles ?? true
    };
  }

  async configure(guildId: string, patch: Partial<SecurityConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO security_settings(
        guild_id,enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,
        quarantine_role_id,log_channel_id,incident_duration_seconds,auto_quarantine,remove_executor_roles
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(guild_id) DO UPDATE SET
        enabled=EXCLUDED.enabled,
        max_joins=EXCLUDED.max_joins,
        window_seconds=EXCLUDED.window_seconds,
        max_destructive_actions=EXCLUDED.max_destructive_actions,
        destructive_window_seconds=EXCLUDED.destructive_window_seconds,
        quarantine_role_id=EXCLUDED.quarantine_role_id,
        log_channel_id=EXCLUDED.log_channel_id,
        incident_duration_seconds=EXCLUDED.incident_duration_seconds,
        auto_quarantine=EXCLUDED.auto_quarantine,
        remove_executor_roles=EXCLUDED.remove_executor_roles,
        updated_at=now()`,
      [
        guildId,
        next.enabled,
        Math.min(Math.max(next.maxJoins, 2), 200),
        Math.min(Math.max(next.windowSeconds, 5), 300),
        Math.min(Math.max(next.maxDestructiveActions, 2), 100),
        Math.min(Math.max(next.destructiveWindowSeconds, 5), 300),
        next.quarantineRoleId,
        next.logChannelId,
        clampSecurityIncidentDuration(next.incidentDurationSeconds),
        next.autoQuarantine,
        next.removeExecutorRoles
      ]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'security',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId, next.enabled]
    );
  }

  private async restoreActiveIncidents(): Promise<void> {
    this.raidIncidents.clear();
    this.destructiveIncidents.clear();

    const result = await this.db.query<{
      id: string;
      guild_id: string;
      event_type: "raid" | "destructive-burst";
      expires_at: Date | string;
    }>(
      "SELECT id,guild_id,event_type,expires_at FROM security_incidents WHERE resolved_at IS NULL AND expires_at > now() ORDER BY expires_at DESC LIMIT 10000"
    );

    for (const row of result.rows) {
      const expiresAt = new Date(row.expires_at).getTime();
      if (!Number.isFinite(expiresAt)) continue;
      const incident = { id: Number(row.id), expiresAt };
      if (row.event_type === "raid") {
        const current = this.raidIncidents.get(row.guild_id);
        if (!current || incident.expiresAt > current.expiresAt) this.raidIncidents.set(row.guild_id, incident);
      } else {
        const current = this.destructiveIncidents.get(row.guild_id);
        if (!current || incident.expiresAt > current.expiresAt) this.destructiveIncidents.set(row.guild_id, incident);
      }
    }
  }

  private async sweepIncidents(): Promise<void> {
    const expired = await this.db.query<{
      id: string;
      guild_id: string;
      event_type: "raid" | "destructive-burst";
    }>(
      "SELECT id,guild_id,event_type FROM security_incidents WHERE resolved_at IS NULL AND expires_at <= now() ORDER BY id LIMIT 100"
    );

    for (const row of expired.rows) {
      await this.resolveIncident(Number(row.id), row.guild_id).catch((error) => {
        logger.warn("Security incident cleanup failed", {
          guildId: row.guild_id,
          incidentId: row.id,
          error: String(error)
        });
      });
    }

    await this.restoreActiveIncidents();
  }

  private async openIncident(
    guildId: string,
    eventType: "raid" | "destructive-burst",
    config: SecurityConfig,
    metadata: Record<string, unknown>
  ): Promise<{ id: number; expiresAt: number }> {
    const duration = clampSecurityIncidentDuration(config.incidentDurationSeconds);
    const result = await this.db.query<{ id: string; expires_at: Date | string }>(
      "INSERT INTO security_incidents(guild_id,event_type,expires_at,metadata) VALUES($1,$2,now()+make_interval(secs => $3),$4::jsonb) RETURNING id,expires_at",
      [guildId, eventType, duration, JSON.stringify(metadata)]
    );
    const row = result.rows[0];
    if (!row) throw new Error("security_incident_create_failed");
    const incident = { id: Number(row.id), expiresAt: new Date(row.expires_at).getTime() };
    if (eventType === "raid") this.raidIncidents.set(guildId, incident);
    else this.destructiveIncidents.set(guildId, incident);
    return incident;
  }

  private async resolveIncident(incidentId: number, guildId: string): Promise<void> {
    const assignments = await this.db.query<{
      user_id: string;
      role_id: string;
    }>(
      "SELECT user_id,role_id FROM security_quarantine_assignments WHERE incident_id=$1 AND restored_at IS NULL",
      [incidentId]
    );

    const guild = this.client?.guilds.cache.get(guildId);
    for (const assignment of assignments.rows) {
      const member = guild ? await guild.members.fetch(assignment.user_id).catch(() => null) : null;
      const role = guild?.roles.cache.get(assignment.role_id);
      const otherAssignments = await this.db.query<{ incident_id: string }>(
        "SELECT incident_id FROM security_quarantine_assignments WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND incident_id<>$4 AND restored_at IS NULL LIMIT 1",
        [guildId, assignment.user_id, assignment.role_id, incidentId]
      );
      if (!otherAssignments.rows.length && member && role && member.roles.cache.has(role.id)) {
        await member.roles.remove(role, "Security incident ended").catch((error) => {
          logger.warn("Security quarantine role removal failed", {
            guildId,
            incidentId,
            userId: assignment.user_id,
            roleId: assignment.role_id,
            error: String(error)
          });
        });
      }
      await this.db.query(
        "UPDATE security_quarantine_assignments SET restored_at=now() WHERE incident_id=$1 AND user_id=$2 AND role_id=$3",
        [incidentId, assignment.user_id, assignment.role_id]
      );
    }

    await this.db.query(
      "UPDATE security_incidents SET resolved_at=now() WHERE id=$1 AND guild_id=$2 AND resolved_at IS NULL",
      [incidentId, guildId]
    );

    if (this.raidIncidents.get(guildId)?.id === incidentId) this.raidIncidents.delete(guildId);
    if (this.destructiveIncidents.get(guildId)?.id === incidentId) this.destructiveIncidents.delete(guildId);

    await this.audit(guildId, "security.incident-resolved", { incidentId });
  }

  async clearIncidents(guildId: string): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      "SELECT id FROM security_incidents WHERE guild_id=$1 AND resolved_at IS NULL ORDER BY id",
      [guildId]
    );
    for (const row of result.rows) {
      await this.resolveIncident(Number(row.id), guildId);
    }
    return result.rows.length;
  }

  async getActiveIncidents(guildId: string): Promise<Array<{ id: number; eventType: string; expiresAt: string }>> {
    const result = await this.db.query<{ id: string; event_type: string; expires_at: Date | string }>(
      "SELECT id,event_type,expires_at FROM security_incidents WHERE guild_id=$1 AND resolved_at IS NULL AND expires_at > now() ORDER BY expires_at DESC",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type,
      expiresAt: new Date(row.expires_at).toISOString()
    }));
  }

  private async trackQuarantine(
    incidentId: number,
    member: GuildMember,
    config: SecurityConfig
  ): Promise<void> {
    if (!config.autoQuarantine || !config.quarantineRoleId) return;
    if (!member.manageable || member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const botMember = member.guild.members.me;
    const role = member.guild.roles.cache.get(config.quarantineRoleId);
    if (!botMember || !role || role.managed || role.position >= botMember.roles.highest.position) return;

    const existingSecurityAssignment = await this.db.query<{ incident_id: string }>(
      "SELECT incident_id FROM security_quarantine_assignments WHERE guild_id=$1 AND user_id=$2 AND role_id=$3 AND restored_at IS NULL LIMIT 1",
      [member.guild.id, member.id, role.id]
    );

    if (member.roles.cache.has(role.id)) {
      if (existingSecurityAssignment.rows.length) {
        await this.db.query(
          "INSERT INTO security_quarantine_assignments(incident_id,guild_id,user_id,role_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [incidentId, member.guild.id, member.id, role.id]
        );
      }
      return;
    }

    try {
      await member.roles.add(role, "Security quarantine");
    } catch (error) {
      logger.warn("Security quarantine role assignment failed", {
        guildId: member.guild.id,
        userId: member.id,
        roleId: role.id,
        error: String(error)
      });
      return;
    }

    await this.db.query(
      "INSERT INTO security_quarantine_assignments(incident_id,guild_id,user_id,role_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [incidentId, member.guild.id, member.id, role.id]
    );
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "security") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "clear") {
      const cleared = await this.clearIncidents(interaction.guild!.id);
      await interaction.reply({
        content: cleared ? `Закрыто инцидентов: ${cleared}.` : "Активных Security-инцидентов нет.",
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
    const bucket = (this.joins.get(member.guild.id) ?? []).filter((entry) => entry.timestamp >= cutoff);
    bucket.push({ timestamp: now, userId: member.id });
    this.joins.set(member.guild.id, bucket);
    this.pruneBuckets(now);
    const activeIncident = this.raidIncidents.get(member.guild.id);
    const raidTriggered = bucket.length >= config.maxJoins;
    if (activeIncident && now < activeIncident.expiresAt) {
      await this.trackQuarantine(activeIncident.id, member, config);
      return;
    }
    if (!raidTriggered) return;

    const incident = await this.openIncident(member.guild.id, "raid", config, {
      joins: bucket.length,
      windowSeconds: config.windowSeconds
    });
    const raidMetadata = { joins: bucket.length, windowSeconds: config.windowSeconds, incidentId: incident.id, incidentDurationSeconds: config.incidentDurationSeconds };
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
      if (target) await this.trackQuarantine(incident.id, target, config);
    }
    await this.alert(member.guild.id, config, `Anti-Raid: ${bucket.length} входов за ${config.windowSeconds} сек.`);
  }

  private async onDestructive(guildId: string | null, type: string, targetUserId?: string): Promise<void> {
    if (!guildId || !await moduleEnabled(this.db, guildId, "security", false)) return;
    const config = await this.config(guildId);
    if (!config.enabled) return;
    const now = Date.now();
    const cutoff = now - config.destructiveWindowSeconds * 1000;
    const bucket = (this.destructive.get(guildId) ?? []).filter((entry) => entry.timestamp >= cutoff);
    bucket.push({ timestamp: now, type });
    this.destructive.set(guildId, bucket);
    this.pruneBuckets(now);
    const activeIncident = this.destructiveIncidents.get(guildId);
    if (!shouldTriggerSecurityIncident(now, activeIncident?.expiresAt ?? 0, bucket.length, config.maxDestructiveActions)) return;

    const incident = await this.openIncident(guildId, "destructive-burst", config, {
      type,
      actions: bucket.length,
      windowSeconds: config.destructiveWindowSeconds
    });
    const burstMetadata = { type, actions: bucket.length, windowSeconds: config.destructiveWindowSeconds, incidentId: incident.id, incidentDurationSeconds: config.incidentDurationSeconds };
    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'destructive-burst',$2::jsonb)",
      [guildId,JSON.stringify(burstMetadata)]
    );
    await this.audit(guildId, "security.destructive-burst", burstMetadata);
    const executors = await this.findRecentExecutors(guildId, type, targetUserId, config.destructiveWindowSeconds);
    for (const executor of executors) {
      await this.respondToExecutor(guildId, executor.userId, config, type, executor.count, incident.id);
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

    for (const [guildId, incident] of this.raidIncidents) {
      if (incident.expiresAt <= now) this.raidIncidents.delete(guildId);
    }
    for (const [guildId, incident] of this.destructiveIncidents) {
      if (incident.expiresAt <= now) this.destructiveIncidents.delete(guildId);
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

  private async respondToExecutor(guildId: string, userId: string, config: SecurityConfig, type: string, executorCount: number, incidentId: number): Promise<void> {
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
    const removable = config.removeExecutorRoles && executorCount >= responseThreshold &&
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

    await this.trackQuarantine(incidentId, member, config);

    const responseMetadata = {
      userId,
      trigger: type,
      executorCount,
      removedRoles: removable.size,
      quarantine: Boolean(config.quarantineRoleId)
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

export function securityResponseThreshold(maxDestructiveActions: number): number {
  return Math.max(2, Math.ceil(maxDestructiveActions / 2));
}

export function securityAuditLookbackCutoff(now: number, windowSeconds: number): number {
  return now - Math.min(Math.max(windowSeconds, 5), 300) * 1000;
}


export function clampSecurityIncidentDuration(value: number): number {
  if (!Number.isFinite(value)) return 300;
  return Math.min(Math.max(Math.trunc(value), 60), 3600);
}
