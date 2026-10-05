import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAfkNotice,
  isAfkClearRequest,
  normalizeAfkReason
} from "../src/modules/reminders.js";

test("AFK reason uses a stable default and is bounded", () => {
  assert.equal(normalizeAfkReason(), "Отошёл ненадолго.");
  assert.equal(normalizeAfkReason("   "), "Отошёл ненадолго.");
  assert.equal(normalizeAfkReason("  ушёл кушать  "), "ушёл кушать");
  assert.equal(normalizeAfkReason("x".repeat(700)).length, 500);
});

test("AFK clear keywords are case-insensitive", () => {
  assert.equal(isAfkClearRequest("off"), true);
  assert.equal(isAfkClearRequest(" CLEAR "), true);
  assert.equal(isAfkClearRequest("remove"), true);
  assert.equal(isAfkClearRequest("unset"), true);
  assert.equal(isAfkClearRequest("away"), false);
  assert.equal(isAfkClearRequest(""), false);
});

test("AFK notice renders a Discord relative timestamp", () => {
  const timestamp = new Date("2026-10-03T17:00:00.000Z");
  const result = formatAfkNotice("<@123>", "ушёл спать", timestamp);
  assert.match(result, /^<@123> AFK: ушёл спать · с <t:\d+:R>$/);
  assert.match(result, /<t:1791046800:R>/);
});
