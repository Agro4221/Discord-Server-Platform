import test from "node:test";
import assert from "node:assert/strict";
import {
  securityAuditLookbackCutoff,
  shouldTriggerSecurityIncident,
  securityIncidentCooldownUntil,
  securityResponseThreshold,
  clampSecurityIncidentDuration,
  clampSecurityWindowSeconds,
  removeSecurityExecutorRoles,
  securityAuditLogEventType,
  securityAuditDestructiveType,
  clampSecurityExecutorTimeoutMinutes,
  Security
} from "../src/modules/security.js";
import { AuditLogEvent } from "discord.js";

test("Security burst incident is opened only at threshold and outside active window", () => {
  assert.equal(shouldTriggerSecurityIncident(100, 0, 5, 5), true);
  assert.equal(shouldTriggerSecurityIncident(101, 200, 6, 5), false);
  assert.equal(shouldTriggerSecurityIncident(201, 200, 6, 5), true);
  assert.equal(shouldTriggerSecurityIncident(100, 0, 4, 5), false);
});


test("Security response requires at least two destructive actions from one executor", () => {
  assert.equal(securityResponseThreshold(2), 2);
  assert.equal(securityResponseThreshold(3), 2);
  assert.equal(securityResponseThreshold(5), 3);
  assert.equal(securityResponseThreshold(100), 50);
});

test("Security restores the latest active incident per type after restart", async () => {
  const db = {
    async query<T>(text: string) {
      if (text.startsWith("SELECT id,guild_id,event_type,expires_at FROM security_incidents")) {
        return {
          rows: [
            { id: "10", guild_id: "guild-1", event_type: "raid", expires_at: "2026-10-04T13:20:00.000Z" },
            { id: "11", guild_id: "guild-1", event_type: "raid", expires_at: "2026-10-04T13:25:00.000Z" },
            { id: "12", guild_id: "guild-1", event_type: "destructive-burst", expires_at: "2026-10-04T13:22:00.000Z" }
          ]
        } as { rows: T[] };
      }
      return { rows: [] } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const security = new (await import("../src/modules/security.js")).Security(db);
  await (security as unknown as { restoreActiveIncidents: () => Promise<void> }).restoreActiveIncidents();

  const state = security as unknown as {
    raidIncidents: Map<string, { id: number; expiresAt: number }>;
    destructiveIncidents: Map<string, { id: number; expiresAt: number }>;
  };
  assert.equal(state.raidIncidents.get("guild-1")?.id, 11);
  assert.equal(state.destructiveIncidents.get("guild-1")?.id, 12);
});

test("Security restores destructive history after a process restart", async () => {
  const now = Date.now();
  const db = {
    async query<T>(text: string) {
      if (text.startsWith("SELECT guild_id,event_type,metadata,created_at FROM security_events")) {
        const rows = [
          { guild_id: "guild-1", event_type: "destructive-action", metadata: { type: "member.ban", targetUserId: "user-1" }, created_at: new Date(now - 10_000).toISOString() },
          { guild_id: "guild-1", event_type: "destructive-action", metadata: { type: "channel.create" }, created_at: new Date(now - 50_000).toISOString() },
          { guild_id: "guild-1", event_type: "destructive-action", metadata: { type: "channel.create" }, created_at: new Date(now - 61 * 60_000).toISOString() },
          { guild_id: "guild-2", event_type: "security.executor-role-removed", metadata: { type: "role.delete" }, created_at: new Date(now - 5_000).toISOString() }
        ];
        return { rows: rows.filter((row) => row.event_type === "destructive-action") } as { rows: T[] };
      }
      return { rows: [] } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const security = new (await import("../src/modules/security.js")).Security(db);
  await (security as unknown as { restoreDestructiveHistory: () => Promise<void> }).restoreDestructiveHistory();

  const state = security as unknown as {
    destructive: Map<string, { timestamp: number; type: string }[]>;
  };
  assert.deepEqual(state.destructive.get("guild-1")?.map((entry) => entry.type), ["channel.create", "member.ban"]);
  assert.equal(state.destructive.has("guild-2"), false);
});

test("Security persists successful executor-role removals as durable non-reversible history", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return { rows: [] } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const security = new (await import("../src/modules/security.js")).Security(db);
  await (security as unknown as {
    recordExecutorRoleRemoval: (guildId: string, incidentId: number, userId: string, roleId: string, roleName: string) => Promise<void>;
  }).recordExecutorRoleRemoval("guild-1", 42, "user-1", "role-1", "Moderator");

  const call = calls.find((entry) => entry.text.startsWith("INSERT INTO security_events(guild_id,event_type,metadata)"));
  assert.ok(call);
  assert.equal(call?.values[0], "guild-1");
  assert.match(String(call?.text), /'security\.executor-role-removed'/);
  assert.match(String(call?.values[1]), /"reversible":false/);
  assert.match(String(call?.values[1]), /"roleId":"role-1"/);
});

test("Security incident cooldown survives a process restart", () => {
  const createdAt = 1_000;
  assert.equal(securityIncidentCooldownUntil(createdAt, 20), 61_000);
  assert.equal(securityIncidentCooldownUntil(createdAt, 120), 121_000);
});

test("Security executor audit lookback honors configured destructive window", () => {
  assert.equal(securityAuditLookbackCutoff(100_000, 5), 95_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 120), -20_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 1), 95_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 999), -899_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 3600), -3_500_000);
});


test("Security role-removal contract counts only successful removals", async () => {
  const removed = await removeSecurityExecutorRoles(
    [{ id: "role-a" }, { id: "role-b" }, { id: "role-c" }],
    async (role) => {
      if (role.id === "role-b") throw new Error("forbidden");
    }
  );
  assert.deepEqual(removed, ["role-a", "role-c"]);
});

test("Security detection windows are bounded without truncating valid long windows", () => {
  assert.equal(clampSecurityWindowSeconds(1), 5);
  assert.equal(clampSecurityWindowSeconds(20), 20);
  assert.equal(clampSecurityWindowSeconds(3600), 3600);
  assert.equal(clampSecurityWindowSeconds(7200), 3600);
  assert.equal(clampSecurityWindowSeconds(Number.NaN), 20);
});

test("Security incident duration is bounded to safe operator values", () => {
  assert.equal(clampSecurityIncidentDuration(10), 60);
  assert.equal(clampSecurityIncidentDuration(300), 300);
  assert.equal(clampSecurityIncidentDuration(5000), 3600);
  assert.equal(clampSecurityIncidentDuration(Number.NaN), 300);
});


test("Security clear reports only incidents that were actually resolved", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push(text);
      if (text.startsWith("SELECT id FROM security_incidents")) {
        return { rows: [{ id: "1" }, { id: "2" }] } as { rows: T[] };
      }
      if (text.startsWith("SELECT user_id,role_id FROM security_quarantine_assignments")) {
        return String(values[0]) === "2"
          ? { rows: [{ user_id: "456789012345678901", role_id: "999999999999999999" }] }
          : { rows: [] };
      }
      if (text.startsWith("SELECT incident_id FROM security_quarantine_assignments")) {
        return { rows: [] };
      }
      if (text.startsWith("UPDATE security_incidents SET resolved_at")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith("UPDATE security_quarantine_assignments SET restored_at")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }
  } as unknown as import("../src/database.js").Database;

  const security = new (await import("../src/modules/security.js")).Security(db);
  const member = {
    roles: {
      cache: { has: () => true },
      remove: async () => { throw new Error("role removal failed"); }
    }
  };
  const guild = {
    members: {
      fetch: async () => member
    },
    roles: {
      cache: new Map([["999999999999999999", { id: "999999999999999999" }]])
    }
  };
  (security as unknown as { client: { guilds: { cache: Map<string, unknown> } } }).client = {
    guilds: { cache: new Map([["guild-1", guild]]) }
  };

  assert.equal(await security.clearIncidents("guild-1"), 1);
  assert.equal(queries.filter((query) => query.startsWith("UPDATE security_incidents SET resolved_at")).length, 1);
});

test("Security anti-nuke tracks channel/role create and delete audit actions", () => {
  assert.equal(securityAuditLogEventType("channel.create"), AuditLogEvent.ChannelCreate);
  assert.equal(securityAuditLogEventType("channel.delete"), AuditLogEvent.ChannelDelete);
  assert.equal(securityAuditLogEventType("role.create"), AuditLogEvent.RoleCreate);
  assert.equal(securityAuditLogEventType("role.delete"), AuditLogEvent.RoleDelete);
  assert.equal(securityAuditLogEventType("member.ban"), AuditLogEvent.MemberBanAdd);
  assert.throws(() => securityAuditLogEventType("unsupported"), /Unsupported security audit event type/);
});

test("Security maps extended destructive audit actions into anti-nuke event types", () => {
  assert.equal(securityAuditDestructiveType(AuditLogEvent.MemberKick)?.type, "member.kick");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.WebhookDelete)?.type, "webhook.delete");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.EmojiDelete)?.type, "emoji.delete");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.StickerDelete)?.type, "sticker.delete");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.ChannelOverwriteUpdate)?.type, "channel.overwrite.update");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.MemberPrune)?.type, "member.prune");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.IntegrationDelete)?.type, "integration.delete");
  assert.equal(securityAuditDestructiveType(AuditLogEvent.GuildUpdate), null);
});

test("Security audit type resolver covers extended destructive event names", () => {
  assert.equal(securityAuditLogEventType("member.kick"), AuditLogEvent.MemberKick);
  assert.equal(securityAuditLogEventType("webhook.delete"), AuditLogEvent.WebhookDelete);
  assert.equal(securityAuditLogEventType("emoji.delete"), AuditLogEvent.EmojiDelete);
  assert.equal(securityAuditLogEventType("sticker.delete"), AuditLogEvent.StickerDelete);
  assert.equal(securityAuditLogEventType("channel.overwrite.delete"), AuditLogEvent.ChannelOverwriteDelete);
  assert.equal(securityAuditLogEventType("member.prune"), AuditLogEvent.MemberPrune);
  assert.equal(securityAuditLogEventType("integration.delete"), AuditLogEvent.IntegrationDelete);
});


test("Security executor timeout is bounded and disabled by zero", () => {
  assert.equal(clampSecurityExecutorTimeoutMinutes(-1), 0);
  assert.equal(clampSecurityExecutorTimeoutMinutes(0), 0);
  assert.equal(clampSecurityExecutorTimeoutMinutes(15.9), 15);
  assert.equal(clampSecurityExecutorTimeoutMinutes(40320), 40320);
  assert.equal(clampSecurityExecutorTimeoutMinutes(50000), 40320);
  assert.equal(clampSecurityExecutorTimeoutMinutes(Number.NaN), 0);
});

test("Security configure persists executor timeout policy", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (text.startsWith("SELECT enabled,max_joins")) {
        return {
          rows: [{
            enabled: true,
            max_joins: 10,
            window_seconds: 20,
            max_destructive_actions: 5,
            destructive_window_seconds: 20,
            quarantine_role_id: null,
            log_channel_id: null,
            incident_duration_seconds: 300,
            auto_quarantine: true,
            remove_executor_roles: true,
            executor_timeout_minutes: 0
          }]
        } as { rows: T[] };
      }
      return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
    }
  } as unknown as import("../src/database.js").Database;

  const security = new Security(db);
  await security.configure("guild-1", { executorTimeoutMinutes: 30 });

  const insert = calls.find((entry) => entry.text.startsWith("INSERT INTO security_settings"));
  assert.ok(insert);
  assert.equal(insert?.values.at(-1), 30);
  assert.match(insert?.text ?? "", /executor_timeout_minutes/);
});
