import test from "node:test";
import assert from "node:assert/strict";

import { validateAutomationRule } from "../src/modules/automation-engine.js";

test("Automation validation accepts richer safe primitives and event-relative builder references", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [
    { type: "starts-with", left: "content", right: "!" },
    { type: "ends-with", left: "content", right: "?" },
    { type: "number-eq", left: "mentionCount", right: 0 },
    { type: "number-gt", left: "attachmentCount", right: 0 },
    { type: "number-lt", left: "memberCount", right: 1000 },
    { type: "number-gte", left: "attachmentCount", right: 1 },
    { type: "contains", left: "previousChannelId", right: "123456789012345678" },
    { type: "has-role", userId: "@event", roleId: "123456789012345678" }
  ], [
    { type: "send-message", channelId: "@event", content: "Acknowledged {user}." },
    { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "👍" },
    { type: "remove-reaction", channelId: "@event", messageId: "@event", emoji: "👍" },
    { type: "pin-message", channelId: "@event", messageId: "@event" },
    { type: "unpin-message", channelId: "@event", messageId: "@event" }
  ]));
});

test("Automation validation rejects malformed reaction actions", () => {
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "" }
  ]), /invalid_reaction_emoji/);

  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "x".repeat(101) }
  ]), /invalid_reaction_emoji/);
});


test("Automation validation rejects malformed message action references", () => {
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "pin-message", channelId: "bad", messageId: "@event" }
  ]), /invalid_message_action_channel/);
});

test("Automation validation covers channel management actions", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [], [
    { type: "set-slowmode", channelId: "@event", seconds: 30 },
    { type: "set-channel-topic", channelId: "@event", topic: "Topic {content}" },
    { type: "set-channel-name", channelId: "@event", name: "ticket-{userId}" },
    { type: "clear-cooldown", key: "welcome-{userId}" },
    { type: "set-cooldown", key: "welcome-{userId}", durationSeconds: 60 }
  ]));
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-slowmode", channelId: "@event", seconds: 21601 }
  ]), /invalid_slowmode_seconds/);
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-channel-topic", channelId: "@event", topic: "x".repeat(1025) }
  ]), /automation_topic_too_long/);
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-channel-name", channelId: "@event", name: " ".repeat(10) }
  ]), /invalid_channel_name/);
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-channel-name", channelId: "@event", name: "x".repeat(101) }
  ]), /invalid_channel_name/);
});


test("Automation numeric comparison conditions use strict greater-than and less-than semantics", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [
    { type: "number-gt", left: "attachmentCount", right: 1 },
    { type: "number-lt", left: "messageLength", right: 1000 }
  ], [
    { type: "log", message: "numeric comparison" }
  ]));
  assert.throws(() => validateAutomationRule("message.create", [
    { type: "number-gt", left: "attachmentCount", right: Number.NaN }
  ], [
    { type: "log", message: "numeric comparison" }
  ]), /invalid_numeric_condition/);
});


test("Automation clear-cooldown action is accepted and validates its key", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [], [
    { type: "clear-cooldown", key: "welcome-{userId}" }
  ]));
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "clear-cooldown", key: "" }
  ]), /invalid_clear_cooldown_key/);
});


test("Automation set-cooldown action validates duration bounds", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [], [
    { type: "set-cooldown", key: "welcome-{userId}", durationSeconds: 60 }
  ]));
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-cooldown", key: "welcome", durationSeconds: 0 }
  ]), /invalid_set_cooldown_action/);
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-cooldown", key: "welcome", durationSeconds: 86401 }
  ]), /invalid_set_cooldown_action/);
});


test("Automation cooldown actions set and clear rendered keyed cooldowns", async () => {
  const db = {
    async query<T>() {
      return { rows: [] } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const engine = new (await import("../src/modules/automation-engine.js")).AutomationEngine(db);
  const state = engine as unknown as {
    keyedCooldowns: Map<string, number>;
    perform: (actions: unknown[], event: {
      type: "message.create";
      guildId: string;
      userId: string;
    }) => Promise<void>;
  };

  const before = Date.now();
  await state.perform([
    { type: "set-cooldown", key: "welcome-{userId}", durationSeconds: 60 }
  ], {
    type: "message.create",
    guildId: "guild-1",
    userId: "user-1"
  });

  const key = "guild-1:welcome-user-1";
  const expiresAt = state.keyedCooldowns.get(key);
  assert.ok(expiresAt);
  assert.ok(expiresAt >= before + 59_000);
  assert.ok(expiresAt <= before + 61_500);

  await state.perform([
    { type: "clear-cooldown", key: "welcome-{userId}" }
  ], {
    type: "message.create",
    guildId: "guild-1",
    userId: "user-1"
  });

  assert.equal(state.keyedCooldowns.has(key), false);
});
