import test from "node:test";
import assert from "node:assert/strict";
import { formatAfkDuration, normalizeAfkReason } from "../src/modules/utility.js";
import { MODULE_CATALOG } from "../src/modules/catalog.js";

test("AFK duration formatter stays human-readable across time units", () => {
  const now = Date.parse("2026-10-03T00:00:00.000Z");
  assert.equal(formatAfkDuration(new Date(now), now), "0с");
  assert.equal(formatAfkDuration(new Date(now - 59_000), now), "59с");
  assert.equal(formatAfkDuration(new Date(now - 60_000), now), "1м");
  assert.equal(formatAfkDuration(new Date(now - 3_600_000), now), "1ч");
  assert.equal(formatAfkDuration(new Date(now - 86_400_000), now), "1д");
  assert.equal(formatAfkDuration(new Date(now + 60_000), now), "0с");
});

test("AFK reason is normalized and bounded", () => {
  assert.equal(normalizeAfkReason("   отошёл   "), "отошёл");
  assert.equal(normalizeAfkReason(""), "Отошёл");
  assert.equal(normalizeAfkReason(" ".repeat(40)), "Отошёл");
  assert.equal(normalizeAfkReason("x".repeat(500)).length, 300);
});

test("utility module is catalogued and enabled by default", () => {
  const utility = MODULE_CATALOG.find((module) => module.key === "utility");
  assert.ok(utility);
  assert.equal(utility.defaultEnabled, true);
});
