import test from "node:test";
import assert from "node:assert/strict";
import { validateAutomationRule } from "../src/modules/automation-engine.js";

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
