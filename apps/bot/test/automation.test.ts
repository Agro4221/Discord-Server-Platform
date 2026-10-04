import test from "node:test";
import assert from "node:assert/strict";

import { validateAutomationRule } from "../src/modules/automation-engine.js";

test("Automation validation accepts richer safe primitives and event-relative builder references", () => {
  assert.doesNotThrow(() => validateAutomationRule("message.create", [
    { type: "starts-with", left: "content", right: "!" },
    { type: "ends-with", left: "content", right: "?" },
    { type: "number-eq", left: "mentionCount", right: 0 },
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
    { type: "set-channel-topic", channelId: "@event", topic: "Topic {content}" }
  ]));
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-slowmode", channelId: "@event", seconds: 21601 }
  ]), /invalid_slowmode_seconds/);
  assert.throws(() => validateAutomationRule("message.create", [], [
    { type: "set-channel-topic", channelId: "@event", topic: "x".repeat(1025) }
  ]), /automation_topic_too_long/);
});
