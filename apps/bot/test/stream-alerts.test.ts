import test from "node:test";
import assert from "node:assert/strict";
import {
  StreamAlerts,
  normalizeStreamAlertTarget,
  clampStreamAlertInterval
} from "../src/modules/stream-alerts.js";

test("Stream Alerts exposes YouTube through the local yt-dlp fallback", () => {
  const module = new StreamAlerts({} as any, {
    vkApiBaseUrl: "https://example.test",
    pollIntervalSeconds: 30,
    ytDlpPath: "yt-dlp"
  });
  assert.deepEqual(module.providers(), { twitch: false, youtube: true, vk: true });
});

test("Stream Alerts normalizes supported targets", () => {
  assert.equal(normalizeStreamAlertTarget("twitch", "https://twitch.tv/FooBar"), "FooBar");
  assert.equal(normalizeStreamAlertTarget("youtube", "https://www.youtube.com/@Foo.Bar"), "@Foo.Bar");
  assert.equal(normalizeStreamAlertTarget("youtube", "https://www.youtube.com/channel/UC12345678901234567890"), "UC12345678901234567890");
  assert.equal(normalizeStreamAlertTarget("vk", "https://live.vkvideo.ru/channel-slug"), "channel-slug");
});

test("Stream Alerts clamps polling interval to the safe bounds", () => {
  assert.equal(clampStreamAlertInterval(1), 15);
  assert.equal(clampStreamAlertInterval(30), 30);
  assert.equal(clampStreamAlertInterval(99999), 3600);
  assert.throws(() => clampStreamAlertInterval(Number.NaN), /invalid_stream_alert_interval/);
});
