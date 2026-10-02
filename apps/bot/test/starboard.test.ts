import test from "node:test";
import assert from "node:assert/strict";
import { shouldRollbackStarboardPublication } from "../src/modules/starboard.js";

test("Starboard rollback runs only when a new message was actually published", () => {
  assert.equal(shouldRollbackStarboardPublication(null), false);
  assert.equal(shouldRollbackStarboardPublication("123456789"), true);
});
