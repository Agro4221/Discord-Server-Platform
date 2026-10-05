import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCredentialInput } from "../src/integration-credentials.js";

test("TikTok integration credentials require client credentials and refreshable user tokens", () => {
  const normalized = normalizeCredentialInput({
    provider: "tiktok",
    label: " Main TikTok ",
    clientId: "client-key",
    clientSecret: "client-secret",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    openId: "open-id",
    expiresAt: 1000,
    refreshExpiresAt: 2000,
    scope: "user.info.basic,video.list"
  });

  assert.equal(normalized.provider, "tiktok");
  assert.equal(normalized.label, "Main TikTok");
  assert.equal(normalized.secret.accessToken, "access-token");
  assert.equal(normalized.secret.refreshToken, "refresh-token");
  assert.equal(normalized.secret.openId, "open-id");
  assert.equal(normalized.secret.scope, "user.info.basic,video.list");
  assert.equal(normalized.secret.expiresAt, 1000);
  assert.equal(normalized.secret.refreshExpiresAt, 2000);
});

test("TikTok integration credential normalization rejects incomplete OAuth credentials", () => {
  assert.throws(
    () => normalizeCredentialInput({
      provider: "tiktok",
      label: "Broken TikTok",
      clientId: "client-key",
      clientSecret: "client-secret",
      accessToken: "access-token"
    }),
    /invalid_tiktok_refresh_token/
  );
});
