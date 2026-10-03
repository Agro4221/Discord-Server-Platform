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
