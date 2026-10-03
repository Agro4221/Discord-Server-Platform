import test from "node:test";
import assert from "node:assert/strict";
import { AutomationEngine, automationRetryDelaySeconds, validateAutomationRule } from "../src/modules/automation-engine.js";

test("Automation conditional branches validate nested actions and depth", () => {
  assert.doesNotThrow(() => validateAutomationRule(
    "message.create",
    [],
    [{
      type: "branch",
      condition: { type: "contains", left: "content", right: "hello" },
      thenActions: [{ type: "send-message", channelId: "12345678901234567", content: "yes" }],
      elseActions: [{ type: "log", message: "no" }]
    }]
  ));

  assert.throws(() => validateAutomationRule(
    "message.create",
    [],
    [{
      type: "branch",
      condition: { type: "contains", left: "content", right: "hello" },
      thenActions: [{
        type: "branch",
        condition: { type: "equals", left: "guildId", right: "12345678901234567" },
        thenActions: [{
          type: "branch",
          condition: { type: "equals", left: "channelId", right: "12345678901234567" },
          thenActions: [{
            type: "branch",
            condition: { type: "equals", left: "userId", right: "12345678901234567" },
            thenActions: [{ type: "log", message: "too deep" }],
            elseActions: [{ type: "log", message: "too deep" }]
          }],
          elseActions: [{ type: "log", message: "nested" }]
        }],
        elseActions: [{ type: "log", message: "nested" }]
      }],
      elseActions: [{ type: "log", message: "no" }]
    }]
  ), /automation_branch_too_deep/);
});


test("Automation supports moderation punishments", () => {
  assert.doesNotThrow(() => validateAutomationRule("member.join", [], [
    { type: "warn", userId: "@event", reason: "automatic warning" },
    { type: "kick", userId: "@event", reason: "automatic kick" },
    { type: "ban", userId: "@event", reason: "automatic ban", durationMinutes: 60 }
  ]));
});

test("Automation rejects malformed moderation punishment durations", () => {
  assert.throws(() => validateAutomationRule("member.join", [], [{ type: "ban", userId: "@event", reason: "automatic ban", durationMinutes: 0 }]), /invalid_ban_action/);
});


test("Automation supports expanded moderation context fields", () => {
  assert.doesNotThrow(() => validateAutomationRule("moderation.case", [
    { type: "equals", left: "action", right: "ban" },
    { type: "number-gte", left: "caseId", right: 1 }
  ], [{ type: "log", message: "automation moderation context" }]));
});


test("Automation dry-run evaluates conditions and renders actions without execution", async () => {
  const engine = new AutomationEngine(
    {} as import("../src/database.js").Database,
    {} as import("../src/modules/moderation.js").Moderation
  );
  const result = await engine.dryRun({
    guildId: "123456789012345678",
    event: "message.create",
    conditions: [{ type: "contains", left: "content", right: "hello" }],
    anyConditions: [],
    actions: [{ type: "log", message: "Seen {content} in {channel}" }],
    content: "Hello from dry run",
    channelId: "234567890123456789"
  });
  assert.equal(result.matched, true);
  assert.equal(result.renderedActions.length, 1);
  assert.match(result.renderedActions[0]?.preview ?? "", /Hello from dry run/);
});

test("Automation dry-run returns no action previews when conditions do not match", async () => {
  const engine = new AutomationEngine(
    {} as import("../src/database.js").Database,
    {} as import("../src/modules/moderation.js").Moderation
  );
  const result = await engine.dryRun({
    guildId: "123456789012345678",
    event: "message.create",
    conditions: [{ type: "contains", left: "content", right: "expected" }],
    anyConditions: [],
    actions: [{ type: "log", message: "must not execute" }],
    content: "different"
  });
  assert.equal(result.matched, false);
  assert.equal(result.renderedActions.length, 0);
});

test("Automation diagnostics expose safe rule and delayed-job health", async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes("FROM automation_rules WHERE guild_id=$1")) {
        return {
          rows: [{
            id: "2", guild_id: "123456789012345678", name: "Rule 2", enabled: true,
            event: "message.create", conditions: [], any_conditions: [], actions: [], cooldown_seconds: 0
          }, {
            id: "1", guild_id: "123456789012345678", name: "Rule 1", enabled: false,
            event: "message.create", conditions: [], any_conditions: [], actions: [], cooldown_seconds: 0
          }]
        };
      }
      if (sql.includes("FROM automation_templates WHERE guild_id=$1")) {
        return { rows: [{ name: "welcome", content: "Hello {user}" }] };
      }
      if (sql.includes("COUNT(*) FILTER")) {
        return {
          rows: [{
            pending: "2",
            processing: "1",
            with_errors: "1",
            dead_lettered: "1",
            completed_24h: "4",
            oldest_pending_at: "2026-10-04T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("FROM automation_delayed_jobs WHERE guild_id=$1")) {
        return {
          rows: [{
            id: "42",
            rule_id: "2",
            attempts: "3",
            available_at: "2026-10-04T00:00:00.000Z",
            processing_until: new Date(Date.now() + 60_000).toISOString(),
            last_error: "provider failed",
            dead_lettered_at: null,
            completed_at: null,
            created_at: "2026-10-04T00:00:00.000Z"
          }, {
            id: "41",
            rule_id: "1",
            attempts: "1",
            available_at: "2026-10-03T23:00:00.000Z",
            processing_until: null,
            last_error: null,
            dead_lettered_at: "2026-10-04T00:30:00.000Z",
            completed_at: null,
            created_at: "2026-10-03T23:00:00.000Z"
          }]
        };
      }
      throw new Error("unexpected query: " + sql);
    }
  } as unknown as import("../src/database.js").Database;

  const engine = new AutomationEngine(db, {} as import("../src/modules/moderation.js").Moderation);
  const diagnostics = await engine.diagnostics("123456789012345678");

  assert.deepEqual(diagnostics.rules, {
    total: 2,
    enabled: 1,
    byEvent: { "message.create": 2 }
  });
  assert.equal(diagnostics.templates.total, 1);
  assert.deepEqual(diagnostics.delayedJobs.pending, 2);
  assert.deepEqual(diagnostics.delayedJobs.processing, 1);
  assert.deepEqual(diagnostics.delayedJobs.withErrors, 1);
  assert.deepEqual(diagnostics.delayedJobs.completed24h, 4);
  assert.equal(diagnostics.delayedJobs.recent.length, 2);
  assert.equal(diagnostics.delayedJobs.recent[0]?.status, "processing");
  assert.equal(diagnostics.delayedJobs.recent[0]?.attempts, 3);
  assert.equal(diagnostics.delayedJobs.recent[0]?.lastError, "provider failed");
  assert.equal(diagnostics.delayedJobs.recent[1]?.status, "dead-lettered");
  assert.equal(diagnostics.runtime.loadedRules, 0);
});

test("Automation retry backoff is bounded and dead-letters after five attempts", () => {
  assert.equal(automationRetryDelaySeconds(1), 5);
  assert.equal(automationRetryDelaySeconds(2), 10);
  assert.equal(automationRetryDelaySeconds(5), 80);
  assert.equal(automationRetryDelaySeconds(20), 300);
});

test("Automation accepts expanded Discord trigger catalog", () => {
  for (const event of ["reaction.remove", "channel.delete", "role.delete", "member.ban"] as const) {
    assert.doesNotThrow(() =>
      validateAutomationRule(event, [], [{ type: "log", message: "expanded trigger" }])
    );
  }
});
