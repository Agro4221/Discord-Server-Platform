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
  const stored: Record<string, any> = {};
  const db = {
    query: async (text: string, values?: unknown[]) => {
      if (text.startsWith("SELECT token_ciphertext")) {
        return { rows: stored.value ? [stored.value] : [], rowCount: stored.value ? 1 : 0 };
      }
      if (text.startsWith("SELECT bi.client_id")) {
        return {
          rows: stored.identity
            ? [{
                client_id: stored.identity.client_id,
                token_ciphertext: stored.value?.token_ciphertext ?? null,
                token_iv: stored.value?.token_iv ?? null,
                token_auth_tag: stored.value?.token_auth_tag ?? null
              }]
            : [],
          rowCount: stored.identity ? 1 : 0
        };
      }
      if (text.startsWith("INSERT INTO bot_credentials")) {
        if (stored.value) return { rows: [], rowCount: 0 };
        stored.value = {
          token_ciphertext: values?.[1],
          token_iv: values?.[2],
          token_auth_tag: values?.[3]
        };
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    transaction: async () => undefined
  } as never;

  const vault = new BotCredentialsService(db, KEY);
  stored.identity = { client_id: "123456789012345678" };

  assert.equal(await vault.bootstrapFromEnvironment("primary", TOKEN), true);
  const cipher = String(stored.value.token_ciphertext);
  assert.equal(cipher.includes(TOKEN), false);
  assert.notEqual(cipher, TOKEN);
  assert.equal(await vault.getToken("primary"), TOKEN);

  const runtime = await vault.resolveRuntimeCredentials(
    "primary",
    "synthetic-environment-token-" + "y".repeat(40),
    "999999999999999999"
  );
  assert.equal(runtime.source, "database");
  assert.equal(runtime.token, TOKEN);
  assert.equal(runtime.clientId, "123456789012345678");

  assert.equal(await vault.bootstrapFromEnvironment("primary", "synthetic-environment-token-" + "y".repeat(40)), false);
});

test("vault rejects invalid encryption keys", () => {
  assert.throws(
    () => new BotCredentialsService({} as never, "not-a-key"),
    /BOT_CREDENTIALS_ENCRYPTION_KEY/
  );
});


test("runtime credential resolution fails closed after stored credential corruption", async () => {
  const stored: Record<string, any> = {
    value: {
      token_ciphertext: "bad",
      token_iv: "bad",
      token_auth_tag: "bad"
    },
    identity: { client_id: "123456789012345678" }
  };
  const db = {
    query: async (text: string) => {
      if (text.startsWith("SELECT bi.client_id")) return { rows: [{
        client_id: stored.identity.client_id,
        token_ciphertext: stored.value.token_ciphertext,
        token_iv: stored.value.token_iv,
        token_auth_tag: stored.value.token_auth_tag
      }] };
      return { rows: [] };
    },
    transaction: async () => undefined
  } as never;
  const vault = new BotCredentialsService(db, KEY);
  await assert.rejects(
    vault.resolveRuntimeCredentials("primary", "synthetic-new-token-" + "z".repeat(30)),
    /invalid_stored_bot_credential/
  );
});
