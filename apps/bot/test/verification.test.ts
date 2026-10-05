import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVerificationText } from "../src/modules/verification.js";

test("verification copy normalization trims valid text", () => {
  assert.equal(normalizeVerificationText("  Verify me  ", 80), "Verify me");
});

test("verification copy normalization rejects empty values", () => {
  assert.throws(() => normalizeVerificationText("   ", 80), /invalid_verification_text/);
  assert.throws(() => normalizeVerificationText(null, 80), /invalid_verification_text/);
});

test("verification copy normalization enforces maximum length", () => {
  assert.throws(() => normalizeVerificationText("a".repeat(81), 80), /invalid_verification_text/);
});
