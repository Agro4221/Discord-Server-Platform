import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOnboardingSteps, normalizeOnboardingTrigger } from "../src/modules/onboarding.js";

test("onboarding trigger accepts only supported lifecycle events", () => {
  assert.equal(normalizeOnboardingTrigger("member.join"), "member.join");
  assert.equal(normalizeOnboardingTrigger("verification.passed"), "verification.passed");
  assert.throws(() => normalizeOnboardingTrigger("message.create"), /invalid_onboarding_trigger/);
});

test("onboarding steps normalize order and reject unsafe definitions", () => {
  assert.deepEqual(
    normalizeOnboardingSteps([
      { type: "role", roleId: "123456789012345678" },
      { type: "channel-message", channelId: "123456789012345679", content: " Hello {mention}! " },
      { type: "dm", content: "Welcome {server}" }
    ]),
    [
      { type: "role", roleId: "123456789012345678" },
      { type: "channel-message", channelId: "123456789012345679", content: "Hello {mention}!" },
      { type: "dm", content: "Welcome {server}" }
    ]
  );
  assert.throws(
    () => normalizeOnboardingSteps([{ type: "role", roleId: "bad" }]),
    /invalid_onboarding_role_step/
  );
  assert.throws(
    () => normalizeOnboardingSteps([
      { type: "role", roleId: "123456789012345678" },
      { type: "role", roleId: "123456789012345678" }
    ]),
    /duplicate_onboarding_role/
  );
  assert.throws(
    () => normalizeOnboardingSteps(
      Array.from({ length: 11 }, () => ({ type: "dm", content: "x" }))
    ),
    /invalid_onboarding_steps/
  );
});
