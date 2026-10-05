import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeFeedUrl, isPrivateIp } from "../src/modules/notifications.js";

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


test("notification feed URL policy rejects unsafe URL forms before DNS resolution", async () => {
  await assert.rejects(() => assertSafeFeedUrl("http://example.com/feed"), /feed_must_use_https/);
  await assert.rejects(() => assertSafeFeedUrl("https://user:pass@example.com/feed"), /feed_credentials_not_allowed/);
  await assert.rejects(() => assertSafeFeedUrl("https://localhost/feed"), /private_hostname_not_allowed/);
  await assert.rejects(() => assertSafeFeedUrl("https://service.internal/feed"), /private_hostname_not_allowed/);
  await assert.rejects(() => assertSafeFeedUrl("https://127.0.0.1/feed"), /private_ip_not_allowed/);
  await assert.rejects(() => assertSafeFeedUrl("https://8.8.8.8/feed"), /literal_ip_not_allowed/);
});
