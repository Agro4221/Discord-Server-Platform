import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWelcomeImageUrl } from "../src/modules/welcome.js";

test("welcome image URL normalization accepts HTTPS and trims whitespace", () => {
  assert.equal(
    normalizeWelcomeImageUrl("  https://example.com/welcome.png  "),
    "https://example.com/welcome.png"
  );
});

test("welcome image URL normalization accepts an empty value as disabled", () => {
  assert.equal(normalizeWelcomeImageUrl("   "), null);
  assert.equal(normalizeWelcomeImageUrl(null), null);
});

test("welcome image URL normalization rejects non-HTTPS and malformed URLs", () => {
  assert.throws(() => normalizeWelcomeImageUrl("http://example.com/a.png"), /invalid_welcome_image_url/);
  assert.throws(() => normalizeWelcomeImageUrl("javascript:alert(1)"), /invalid_welcome_image_url/);
  assert.throws(() => normalizeWelcomeImageUrl("not-a-url"), /invalid_welcome_image_url/);
});

test("welcome image URL normalization rejects oversized values", () => {
  assert.throws(() => normalizeWelcomeImageUrl("https://example.com/" + "a".repeat(2048)), /invalid_welcome_image_url/);
});
