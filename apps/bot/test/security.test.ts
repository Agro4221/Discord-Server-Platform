import test from "node:test";
import assert from "node:assert/strict";
import {
  securityAuditLookbackCutoff,
  shouldTriggerSecurityIncident,
  securityIncidentCooldownUntil,
  securityResponseThreshold,
  clampSecurityIncidentDuration,
  clampSecurityWindowSeconds,
  securityAuditLogEventType
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
