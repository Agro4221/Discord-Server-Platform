import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTarget, type StreamAlertPlatform } from "../src/modules/stream-alerts.js";

test("stream alert target normalization accepts Kick URLs, slugs and broadcaster IDs", () => {
  assert.equal(
    normalizeTarget("kick" as StreamAlertPlatform, "https://kick.com/Example_Channel"),
    "example_channel"
  );
  assert.equal(
    normalizeTarget("kick" as StreamAlertPlatform, "Example_Channel"),
    "example_channel"
  );
  assert.equal(
    normalizeTarget("kick" as StreamAlertPlatform, "123456789"),
    "123456789"
  );
});

test("stream alert target normalization rejects invalid Kick slugs", () => {
  assert.throws(
    () => normalizeTarget("kick" as StreamAlertPlatform, "bad slug"),
    /invalid_kick_target/
  );
  assert.throws(
    () => normalizeTarget("kick" as StreamAlertPlatform, ""),
    /stream_alert_target_required/
  );
});
