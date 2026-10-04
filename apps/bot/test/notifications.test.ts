import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, normalizeKeywords, renderFeedTemplate } from "../src/modules/notifications.js";

test("notification SSRF guard rejects private, special and mapped addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.8",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.10.2",
    "172.16.10.20",
    "192.168.1.10",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1"
  ]) {
    assert.equal(isPrivateIp(address), true, address);
  }

  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2001:4860:4860::8888"
  ]) {
    assert.equal(isPrivateIp(address), false, address);
  }
});

test("notification feed filters normalize and templates render supported fields", () => {
  assert.deepEqual(
    normalizeKeywords([" Release ", "release", "", "UPDATE", "update "]),
    ["release", "update"]
  );
  assert.equal(
    renderFeedTemplate("**{title}**\\n{url}\\n{timestamp}", {
      title: "Release 1",
      url: "https://example.com/release"
    }).startsWith("**Release 1**\\nhttps://example.com/release\\n"),
    true
  );
});


test("social feed presets generate provider-specific RSS URLs and reject invalid targets", async () => {
  const { buildSocialFeedUrl } = await import("../src/modules/notifications.js");

  assert.equal(
    buildSocialFeedUrl("reddit", "r/discordapp"),
    "https://www.reddit.com/r/discordapp/new/.rss"
  );
  assert.equal(
    buildSocialFeedUrl("youtube", "UC1234567890123456789012"),
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012"
  );
  assert.equal(
    buildSocialFeedUrl("mastodon", "https://mastodon.social/@example"),
    "https://mastodon.social/@example.rss"
  );
  assert.throws(() => buildSocialFeedUrl("reddit", "bad target"), /invalid_reddit_target/);
  assert.throws(() => buildSocialFeedUrl("youtube", "not-a-channel"), /invalid_youtube_channel/);
  assert.throws(() => buildSocialFeedUrl("mastodon", "https://mastodon.social/"), /invalid_mastodon_target/);
});
