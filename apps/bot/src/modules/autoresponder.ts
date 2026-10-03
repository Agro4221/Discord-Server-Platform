import type { Message } from "discord.js";
import type { Database } from "../database.js";
import type { AuditLog } from "../audit.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export type AutoResponderMatchType = "exact" | "contains" | "starts-with" | "regex";

export type AutoResponderRecord = {
  id: number;
  guildId: string;
  trigger: string;
  matchType: AutoResponderMatchType;
  response: string;
  enabled: boolean;
  deleteTrigger: boolean;
  cooldownSeconds: number;
  priority: number;
  allowedRoleIds: string[];
  ignoredRoleIds: string[];
  allowedChannelIds: string[];
  ignoredChannelIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type AutoResponderInput = {
  trigger: string;
  matchType?: AutoResponderMatchType;
  response: string;
  enabled?: boolean;
  deleteTrigger?: boolean;
  cooldownSeconds?: number;
  priority?: number;
  allowedRoleIds?: string[];
  ignoredRoleIds?: string[];
  allowedChannelIds?: string[];
  ignoredChannelIds?: string[];
};

const MATCH_TYPES = new Set<AutoResponderMatchType>(["exact", "contains", "starts-with", "regex"]);

export class AutoResponder implements PlatformModule {
  readonly name = "autoresponder";
  private unsubscribe?: () => void;
  private readonly cooldowns = new Map<string, number>();
  private readonly ruleCache = new Map<string, { expiresAt: number; rules: AutoResponderRecord[] }>();
  private static readonly RULE_CACHE_TTL_MS = 5_000;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const unsubscribe = context.events.on("message.create", (message) => this.onMessage(message, context.auditLog));
    this.unsubscribe = unsubscribe;
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cooldowns.clear();
    this.ruleCache.clear();
  }

  async list(guildId: string): Promise<AutoResponderRecord[]> {
    const now = Date.now();
    const cached = this.ruleCache.get(guildId);
    if (cached && cached.expiresAt > now) {
      return cached.rules.map((rule) => ({
        ...rule,
        allowedRoleIds: [...rule.allowedRoleIds],
        ignoredRoleIds: [...rule.ignoredRoleIds],
        allowedChannelIds: [...rule.allowedChannelIds],
        ignoredChannelIds: [...rule.ignoredChannelIds]
      }));
    }
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,trigger,match_type,response,enabled,delete_trigger,
              cooldown_seconds,priority,allowed_role_ids,ignored_role_ids,
              allowed_channel_ids,ignored_channel_ids,created_at,updated_at
       FROM autoresponder_rules WHERE guild_id=$1 ORDER BY priority DESC,id ASC`,
      [guildId]
    );
    const rules = result.rows.map((row) => this.mapRow(row));
    this.ruleCache.set(guildId, { expiresAt: now + AutoResponder.RULE_CACHE_TTL_MS, rules });
    return rules.map((rule) => ({
      ...rule,
      allowedRoleIds: [...rule.allowedRoleIds],
      ignoredRoleIds: [...rule.ignoredRoleIds],
      allowedChannelIds: [...rule.allowedChannelIds],
      ignoredChannelIds: [...rule.ignoredChannelIds]
    }));
  }

  async create(guildId: string, input: AutoResponderInput): Promise<AutoResponderRecord> {
    const normalized = validateInput(input);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO autoresponder_rules(
         guild_id,trigger,match_type,response,enabled,delete_trigger,cooldown_seconds,priority,
         allowed_role_ids,ignored_role_ids,allowed_channel_ids,ignored_channel_ids
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        guildId,
        normalized.trigger,
        normalized.matchType,
        normalized.response,
        normalized.enabled,
        normalized.deleteTrigger,
        normalized.cooldownSeconds,
        normalized.priority,
        normalized.allowedRoleIds,
        normalized.ignoredRoleIds,
        normalized.allowedChannelIds,
        normalized.ignoredChannelIds
      ]
    );
    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("autoresponder_create_failed");
    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'autoresponder',true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()",
      [guildId]
    );
    this.ruleCache.delete(guildId);
    return (await this.get(guildId, id))!;
  }

  async update(guildId: string, id: number, input: AutoResponderInput): Promise<AutoResponderRecord | null> {
    const existing = await this.get(guildId, id);
    if (!existing) return null;
    const normalized = validateInput(input);
    await this.db.query(
      `UPDATE autoresponder_rules SET
         trigger=$3,match_type=$4,response=$5,enabled=$6,delete_trigger=$7,cooldown_seconds=$8,priority=$9,
         allowed_role_ids=$10,ignored_role_ids=$11,allowed_channel_ids=$12,ignored_channel_ids=$13,updated_at=now()
       WHERE guild_id=$1 AND id=$2`,
      [
        guildId,
        id,
        normalized.trigger,
        normalized.matchType,
        normalized.response,
        normalized.enabled,
        normalized.deleteTrigger,
        normalized.cooldownSeconds,
        normalized.priority,
        normalized.allowedRoleIds,
        normalized.ignoredRoleIds,
        normalized.allowedChannelIds,
        normalized.ignoredChannelIds
      ]
    );
    this.ruleCache.delete(guildId);
    return this.get(guildId, id);
  }

  async delete(guildId: string, id: number): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM autoresponder_rules WHERE guild_id=$1 AND id=$2",
      [guildId, id]
    );
    if (result.rowCount === 1) this.ruleCache.delete(guildId);
    return result.rowCount === 1;
  }

  private async get(guildId: string, id: number): Promise<AutoResponderRecord | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,trigger,match_type,response,enabled,delete_trigger,
              cooldown_seconds,priority,allowed_role_ids,ignored_role_ids,
              allowed_channel_ids,ignored_channel_ids,created_at,updated_at
       FROM autoresponder_rules WHERE guild_id=$1 AND id=$2`,
      [guildId, id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private async onMessage(message: Message, auditLog: AuditLog): Promise<void> {
    if (!message.guild || message.author.bot || !message.content.trim()) return;
    if (!await moduleEnabled(this.db, message.guild.id, "autoresponder", false)) return;

    const rules = await this.list(message.guild.id);
    for (const rule of rules) {
      if (!rule.enabled || !scopeMatches(message, rule)) continue;
      if (!matchesAutoResponder(rule, message.content)) continue;
      if (!this.takeCooldown(rule, message.guild.id, message.author.id)) continue;

      const content = renderAutoResponder(rule.response, {
        user: message.author.username,
        mention: message.author.toString(),
        server: message.guild.name,
        channel: message.channel.isTextBased() ? ("name" in message.channel ? message.channel.name : message.channelId) : message.channelId
      });
      if (!content) return;

      if (rule.deleteTrigger) {
        await message.delete().catch(() => undefined);
      }

      if ("send" in message.channel) {
        const sent = await message.channel.send({
          content,
          allowedMentions: { users: [message.author.id] }
        });
        await auditLog.record({
          guildId: message.guild.id,
          source: "system",
          action: "autoresponder.triggered",
          targetType: "user",
          targetId: message.author.id,
          metadata: { ruleId: rule.id, messageId: message.id, deleted: rule.deleteTrigger, responseId: sent.id }
        });
      }
      return;
    }
  }

  private takeCooldown(rule: AutoResponderRecord, guildId: string, userId: string): boolean {
    if (rule.cooldownSeconds <= 0) return true;
    const now = Date.now();
    const key = guildId + ":" + rule.id + ":" + userId;
    const previous = this.cooldowns.get(key) ?? 0;
    if (now - previous < rule.cooldownSeconds * 1000) return false;
    this.cooldowns.set(key, now);
    if (this.cooldowns.size > 10_000) {
      for (const [entry, timestamp] of this.cooldowns) {
        if (now - timestamp > 3_600_000) this.cooldowns.delete(entry);
      }
    }
    return true;
  }

  private mapRow(row: Record<string, unknown>): AutoResponderRecord {
    return {
      id: Number(row.id),
      guildId: String(row.guild_id),
      trigger: String(row.trigger),
      matchType: String(row.match_type) as AutoResponderMatchType,
      response: String(row.response),
      enabled: Boolean(row.enabled),
      deleteTrigger: Boolean(row.delete_trigger),
      cooldownSeconds: Number(row.cooldown_seconds ?? 0),
      priority: Number(row.priority ?? 0),
      allowedRoleIds: toIds(row.allowed_role_ids),
      ignoredRoleIds: toIds(row.ignored_role_ids),
      allowedChannelIds: toIds(row.allowed_channel_ids),
      ignoredChannelIds: toIds(row.ignored_channel_ids),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at)
    };
  }
}

export function matchesAutoResponder(rule: Pick<AutoResponderRecord, "trigger" | "matchType">, content: string): boolean {
  const trigger = rule.trigger.trim();
  const normalizedContent = content.trim().toLocaleLowerCase();
  const normalizedTrigger = trigger.toLocaleLowerCase();

  if (rule.matchType === "exact") return normalizedContent === normalizedTrigger;
  if (rule.matchType === "contains") return normalizedContent.includes(normalizedTrigger);
  if (rule.matchType === "starts-with") return normalizedContent.startsWith(normalizedTrigger);
  try {
    return new RegExp(trigger, "i").test(content);
  } catch {
    return false;
  }
}

export function renderAutoResponder(template: string, vars: {
  user: string;
  mention: string;
  server: string;
  channel: string;
}): string {
  return template
    .replaceAll("{user}", vars.user)
    .replaceAll("{mention}", vars.mention)
    .replaceAll("{server}", vars.server)
    .replaceAll("{channel}", vars.channel)
    .slice(0, 2000);
}

function scopeMatches(message: Message, rule: AutoResponderRecord): boolean {
  const channelId = message.channelId;
  if (rule.allowedChannelIds.length && !rule.allowedChannelIds.includes(channelId)) return false;
  if (rule.ignoredChannelIds.includes(channelId)) return false;

  const roleIds = message.member?.roles.cache.map((role) => role.id) ?? [];
  if (rule.allowedRoleIds.length && !rule.allowedRoleIds.some((roleId) => roleIds.includes(roleId))) return false;
  if (rule.ignoredRoleIds.some((roleId) => roleIds.includes(roleId))) return false;
  return true;
}

function validateInput(input: AutoResponderInput): Required<AutoResponderInput> {
  const trigger = input.trigger.trim().slice(0, 300);
  const response = input.response.slice(0, 2000);
  const matchType = input.matchType ?? "contains";
  const cooldownSeconds = input.cooldownSeconds ?? 0;
  const priority = input.priority ?? 0;
  const allowedRoleIds = normalizeIds(input.allowedRoleIds);
  const ignoredRoleIds = normalizeIds(input.ignoredRoleIds);
  const allowedChannelIds = normalizeIds(input.allowedChannelIds);
  const ignoredChannelIds = normalizeIds(input.ignoredChannelIds);

  if (!trigger || !response || !MATCH_TYPES.has(matchType)) throw new Error("invalid_autoresponder_input");
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400) throw new Error("invalid_autoresponder_cooldown");
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) throw new Error("invalid_autoresponder_priority");
  if (matchType === "regex") {
    try { new RegExp(trigger, "i"); } catch { throw new Error("invalid_autoresponder_regex"); }
  }

  return {
    trigger,
    matchType,
    response,
    enabled: input.enabled ?? true,
    deleteTrigger: input.deleteTrigger ?? false,
    cooldownSeconds,
    priority,
    allowedRoleIds,
    ignoredRoleIds,
    allowedChannelIds,
    ignoredChannelIds
  };
}

function normalizeIds(values: string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.filter((value) => /^\d{15,25}$/.test(value)).slice(0, 25))];
}

function toIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}
