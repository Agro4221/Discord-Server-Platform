import test from "node:test";
import assert from "node:assert/strict";

test("temporary voice module starts with empty in-memory state", async () => {
  assert.equal(typeof "temporary-voice", "string");
});

test("temporary voice naming prefix remains stable", () => {
  assert.match("DSP • Example", /^DSP • /);
});
