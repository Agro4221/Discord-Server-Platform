import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnalyticsSettings } from "../src/modules/analytics.js";

test("analytics settings keep only supported visible counters and deduplicate them", () => {
  const result = normalizeAnalyticsSettings({
    retentionDays: 90,
    visibleCounters: [
      "message",
      "message",
      "member_join",
      "unknown",
      "voice_move"
    ] as never
  });

  assert.equal(result.retentionDays, 90);
  assert.deepEqual(result.visibleCounters, ["message", "member_join", "voice_move"]);
});

test("analytics retention is bounded and empty visible selection falls back to defaults", () => {
  const low = normalizeAnalyticsSettings({ retentionDays: -100, visibleCounters: [] });
  assert.equal(low.retentionDays, 1);
  assert.deepEqual(low.visibleCounters, [
    "message",
    "member_join",
    "member_leave",
    "voice_join",
    "voice_leave",
    "voice_move"
  ]);

  const high = normalizeAnalyticsSettings({ retentionDays: 999999 });
  assert.equal(high.retentionDays, 3650);
});

test("analytics settings preserve valid custom visibility selections", () => {
  const result = normalizeAnalyticsSettings({
    retentionDays: 7,
    visibleCounters: ["member_leave", "voice_join"]
  });

  assert.deepEqual(result, {
    retentionDays: 7,
    visibleCounters: ["member_leave", "voice_join"]
  });
});
