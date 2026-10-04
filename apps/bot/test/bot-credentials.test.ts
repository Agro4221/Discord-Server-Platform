import assert from "node:assert/strict";
import test from "node:test";
import { BotCredentialsService, normalizeIdentityId, normalizeToken } from "../src/bot-credentials.js";

const KEY = "ab".repeat(32);
const TOKEN = "synthetic-test-token-" + "x".repeat(40);

test("identity ids are normalized and primary is reserved but valid", () => {
  assert.equal(normalizeIdentityId(" Music-2 "), "music-2");
  assert.equal(normalizeIdentityId("PRIMARY"), "primary");
  assert.throws(() => normalizeIdentityId("bad identity"), /invalid_bot_identity_id/);
});

test("Discord token input is bounded", () => {
  assert.equal(normalizeToken(TOKEN), TOKEN);
  assert.throws(() => normalizeToken("short"), /invalid_discord_token/);
});

test("credential vault encrypts and decrypts without plaintext storage", async () => {
  const stored: Record<string, unknown> = {};
  const db = {
    query: async (text: string, values?: unknown[]) => {
      if (text.startsWith("SELECT token_ciphertext")) {
        return { rows: stored.value ? [stored.value] : [] };
      }
      if (text.startsWith("INSERT INTO bot_credentials")) {
        stored.value = {
          token_ciphertext: values?.[1],
          token_iv: values?.[2],
          token_auth_tag: values?.[3]
        };
      }
      return { rows: [] };
    },
    transaction: async () => undefined
  } as never;

  const vault = new BotCredentialsService(db, KEY);
  await vault.bootstrapFromEnvironment("primary", TOKEN);
  const cipher = String((stored.value as Record<string, unknown>).token_ciphertext);
  assert.equal(cipher.includes(TOKEN), false);
  assert.notEqual(cipher, TOKEN);
  assert.equal(await vault.getToken("primary"), TOKEN);
});

test("vault rejects invalid encryption keys", () => {
  assert.throws(
    () => new BotCredentialsService({} as never, "not-a-key"),
    /BOT_CREDENTIALS_ENCRYPTION_KEY/
  );
});
