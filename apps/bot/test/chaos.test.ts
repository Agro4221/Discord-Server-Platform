import test from "node:test";
import assert from "node:assert/strict";
import { PlatformEventBus } from "../src/events.js";
import { validateAutomationRule } from "../src/modules/automation-engine.js";
import { normalizeMusicRepeatMode } from "../src/modules/music.js";
import { shouldTriggerSecurityIncident } from "../src/modules/security.js";
import { sanitizeMeta } from "../src/logger.js";

test("event bus survives one listener throwing while preserving other listeners", async () => {
  const bus = new PlatformEventBus();
  const received: string[] = [];

  bus.on("schedule", async () => {
    throw new Error("chaos listener failure");
  });
  bus.on("schedule", async (event) => {
    received.push(event.guildId);
  });

  await assert.doesNotReject(
    bus.emit("schedule", { guildId: "123456789012345001", timestamp: Date.now() })
  );
  assert.deepEqual(received, ["123456789012345001"]);
});

test("automation validator rejects malformed generated rules", () => {
  const invalidEvents = ["", "unknown", "MESSAGE_CREATE", "schedule "];
  for (const event of invalidEvents) {
    assert.throws(
      () => validateAutomationRule(event as never, [], [{ type: "log", message: "x" }]),
      /unsupported_automation_event/
    );
  }

  assert.throws(
    () => validateAutomationRule(
      "message.create",
      Array.from({ length: 11 }, () => ({ type: "equals", left: "x", right: "y" })),
      [{ type: "log", message: "x" }]
    ),
    /too_many_conditions/
  );

  assert.throws(
    () => validateAutomationRule(
      "message.create",
      [],
      []
    ),
    /invalid_action_count/
  );

  assert.throws(
    () => validateAutomationRule(
      "message.create",
      [{ type: "matches", left: "content", pattern: "[" }],
      [{ type: "log", message: "x" }]
    ),
    /invalid_automation_pattern/
  );
});

test("Music repeat validator is total for arbitrary strings", () => {
  for (const value of ["", "off", "track", "queue", "loop", "null", "undefined", "\u0000", "🎵"]) {
    const normalized = normalizeMusicRepeatMode(value);
    assert.ok(normalized === null || normalized === "off" || normalized === "track" || normalized === "queue");
  }
});

test("Security incident trigger is monotonic around the threshold", () => {
  for (let count = 0; count < 20; count += 1) {
    const triggered = shouldTriggerSecurityIncident(100, 0, count, 10);
    assert.equal(triggered, count >= 10);
  }
  assert.equal(shouldTriggerSecurityIncident(100, 101, 100, 10), false);
  assert.equal(shouldTriggerSecurityIncident(101, 101, 100, 10), true);
});

test("logger sanitization survives cyclic-like hostile values without exposing secret keys", () => {
  const hostile = {
    token: "do-not-leak",
    nested: { secret: "hidden" },
    huge: "x".repeat(20_000)
  };
  const safe = sanitizeMeta(hostile);
  assert.equal(safe.token, "[REDACTED]");
  assert.deepEqual((safe.nested as Record<string, unknown>).secret, "[REDACTED]");
  assert.match(String(safe.huge), /truncated/);
});


test("Automation ANY condition group matches when at least one condition matches", async () => {
  const { AutomationEngine } = await import("../src/modules/automation-engine.js");
  const db = {} as import("../src/database.js").Database;
  const engine = new AutomationEngine(db);
  const conditions = [
    { type: "equals", left: "content", right: "needle-a" },
    { type: "equals", left: "content", right: "needle-b" }
  ] as const;

  const match = async (event: { content: string }) => {
    const result = await (engine as unknown as {
      conditionsAnyMatch: (
        conditions: typeof conditions,
        event: { guildId: string; type: "message.create"; content: string }
      ) => Promise<boolean>;
    }).conditionsAnyMatch(
      conditions,
      { guildId: "123456789012345901", type: "message.create", content: event.content }
    );
    return result;
  };

  assert.equal(await match({ content: "needle-b" }), true);
  assert.equal(await match({ content: "needle-a" }), true);
  assert.equal(await match({ content: "other" }), false);
});
