import test from "node:test";
import assert from "node:assert/strict";

import { isManagementApiAuthorized, managementApiRateAllows, validateAutomationPayload } from "../src/management-api.js";

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

test("Management API bearer authorization accepts only the exact configured token", () => {
  assert.equal(isManagementApiAuthorized(undefined, "secret"), false);
  assert.equal(isManagementApiAuthorized("Basic secret", "secret"), false);
  assert.equal(isManagementApiAuthorized("Bearer wrong", "secret"), false);
  assert.equal(isManagementApiAuthorized("Bearer secret", "secret"), true);
  assert.equal(isManagementApiAuthorized("Bearer secretx", "secret"), false);
  assert.equal(isManagementApiAuthorized("Bearer secret", "secretx"), false);
});

test("Management API rate limit allows exactly the configured number of requests per minute", () => {
  const windows = new Map<string, { startedAt: number; count: number }>();
  const now = 1_000_000;

  assert.equal(managementApiRateAllows(windows, "client", 3, now), true);
  assert.equal(managementApiRateAllows(windows, "client", 3, now + 1), true);
  assert.equal(managementApiRateAllows(windows, "client", 3, now + 2), true);
  assert.equal(managementApiRateAllows(windows, "client", 3, now + 3), false);
  assert.equal(managementApiRateAllows(windows, "client-2", 3, now + 3), true);
  assert.equal(managementApiRateAllows(windows, "client", 3, now + 60_001), true);
});

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
      { type: "set-channel-name", channelId: "@event", name: "incident-{content}" },
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
