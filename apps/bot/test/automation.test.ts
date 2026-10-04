import { describe, expect, it } from "vitest";

import { validateAutomationRule } from "../src/modules/automation-engine.js";

describe("Automation validation", () => {
  it("accepts richer safe primitives and event-relative builder references", () => {
    expect(() => validateAutomationRule("message.create", [
      { type: "starts-with", left: "content", right: "!" },
      { type: "ends-with", left: "content", right: "?" },
      { type: "number-eq", left: "mentionCount", right: 0 },
      { type: "has-role", userId: "@event", roleId: "123456789012345678" }
    ], [
      { type: "send-message", channelId: "@event", content: "Acknowledged {user}." },
      { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "👍" }
    ])).not.toThrow();
  });

  it("rejects malformed reaction actions", () => {
    expect(() => validateAutomationRule("message.create", [], [
      { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "" }
    ])).toThrow("invalid_reaction_emoji");

    expect(() => validateAutomationRule("message.create", [], [
      { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "x".repeat(101) }
    ])).toThrow("invalid_reaction_emoji");
  });
});
