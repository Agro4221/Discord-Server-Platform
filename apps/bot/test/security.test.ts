import test from "node:test";
import assert from "node:assert/strict";
import {
  securityAuditLookbackCutoff,
  shouldTriggerSecurityIncident,
  securityIncidentCooldownUntil,
  securityResponseThreshold,
  securityResponsePolicy
} from "../src/modules/security.js";

test("Security burst incident is opened only at threshold and outside active window", () => {
  assert.equal(shouldTriggerSecurityIncident(100, 0, 5, 5), true);
  assert.equal(shouldTriggerSecurityIncident(101, 200, 6, 5), false);
  assert.equal(shouldTriggerSecurityIncident(201, 200, 6, 5), true);
  assert.equal(shouldTriggerSecurityIncident(100, 0, 4, 5), false);
});


test("Security response requires at least two destructive actions from one executor", () => {
  assert.equal(securityResponseThreshold(2), 2);
  assert.equal(securityResponseThreshold(3), 2);
  assert.equal(securityResponseThreshold(5), 3);
  assert.equal(securityResponseThreshold(100), 50);
});

test("Security incident cooldown survives a process restart", () => {
  const createdAt = 1_000;
  assert.equal(securityIncidentCooldownUntil(createdAt, 20), 61_000);
  assert.equal(securityIncidentCooldownUntil(createdAt, 120), 121_000);
});

test("Security executor audit lookback honors configured destructive window", () => {
  assert.equal(securityAuditLookbackCutoff(100_000, 5), 95_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 120), -20_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 1), 95_000);
  assert.equal(securityAuditLookbackCutoff(100_000, 999), -200_000);
});


test("Security response policy defaults preserve quarantine and role removal", () => {
  assert.equal(securityResponsePolicy({}), {
    raidQuarantine: true,
    destructiveRoleRemoval: true,
    destructiveQuarantine: true
  });
});

test("Security response policy preserves explicit disabled actions", () => {
  assert.deepEqual(securityResponsePolicy({
    raidQuarantine: false,
    destructiveRoleRemoval: false,
    destructiveQuarantine: false
  }), {
    raidQuarantine: false,
    destructiveRoleRemoval: false,
    destructiveQuarantine: false
  });
});
