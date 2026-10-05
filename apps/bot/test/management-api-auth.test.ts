import test from "node:test";
import assert from "node:assert/strict";
import { isManagementApiAuthorizationValid } from "../src/management-api.js";

test("Management API authorization requires a non-blank exact Bearer key", () => {
  const key = "management-secret";

  assert.equal(isManagementApiAuthorizationValid(undefined, key), false);
  assert.equal(isManagementApiAuthorizationValid("", key), false);
  assert.equal(isManagementApiAuthorizationValid("Basic " + key, key), false);
  assert.equal(isManagementApiAuthorizationValid("Bearer ", key), false);
  assert.equal(isManagementApiAuthorizationValid("Bearer wrong", key), false);
  assert.equal(isManagementApiAuthorizationValid("Bearer " + key + "x", key), false);
  assert.equal(isManagementApiAuthorizationValid("Bearer " + key, key), true);

  for (const blank of ["", " ", "\t", "\n"]) {
    assert.equal(isManagementApiAuthorizationValid("Bearer " + blank, blank), false);
  }
});
