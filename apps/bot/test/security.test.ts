import test from "node:test";
import assert from "node:assert/strict";
import { shouldTriggerSecurityIncident } from "../src/modules/security.js";

test("Security burst incident is opened only at threshold and outside active window", () => {
  assert.equal(shouldTriggerSecurityIncident(100, 0, 5, 5), true);
  assert.equal(shouldTriggerSecurityIncident(101, 200, 6, 5), false);
  assert.equal(shouldTriggerSecurityIncident(201, 200, 6, 5), true);
  assert.equal(shouldTriggerSecurityIncident(100, 0, 4, 5), false);
});
