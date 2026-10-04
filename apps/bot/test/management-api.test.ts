import test from "node:test";
import assert from "node:assert/strict";

import { validateAutomationPayload } from "../src/management-api.js";

function fakeClient() {
  const channel = { id: "123456789012345678", type: 0, isTextBased: () => true };
  const role = { id: "223456789012345678" };
  const guild = {
    channels: { cache: new Map([[channel.id, channel]]) },
    roles: { cache: new Map([[role.id, role]]) }
  };
  return {
    guilds: { cache: new Map([["999999999999999999", guild]]) }
  } as never;
}

test("Management API accepts the full current Automation builder catalog", () => {
  assert.doesNotThrow(() => validateAutomationPayload(
    fakeClient(),
    "999999999999999999",
    "security.incident",
    [
      { type: "starts-with", left: "content", right: "!" },
      { type: "ends-with", left: "content", right: "?" },
      { type: "number-eq", left: "incidentId", right: 42 },
      { type: "has-role", userId: "@event", roleId: "223456789012345678" },
      { type: "channel-is", channelId: "123456789012345678" }
    ],
    [
      { type: "send-message", channelId: "@event", content: "Incident {content}" },
      { type: "add-reaction", channelId: "@event", messageId: "@event", emoji: "🚨" },
      { type: "remove-reaction", channelId: "@event", messageId: "@event", emoji: "🚨" },
      { type: "pin-message", channelId: "@event", messageId: "@event" },
      { type: "unpin-message", channelId: "@event", messageId: "@event" },
      { type: "log", message: "security event" }
    ]
  ));
});

test("Management API rejects Automation conditions/actions outside the shared catalog", () => {
  assert.throws(() => validateAutomationPayload(
    fakeClient(),
    "999999999999999999",
    "message.create",
    [{ type: "unknown-condition" }],
    [{ type: "log", message: "x" }]
  ), /unsupported_automation_condition/);

  assert.throws(() => validateAutomationPayload(
    fakeClient(),
    "999999999999999999",
    "message.create",
    [],
    [{ type: "unknown-action" }]
  ), /unsupported_automation_action/);
});
