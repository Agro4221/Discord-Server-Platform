import test from "node:test";
import assert from "node:assert/strict";
import { resolveIdentityEnv } from "../src/bot-identity.js";

test("primary may use legacy Discord credentials", () => {
  const old = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_TOKEN_PRIMARY: process.env.DISCORD_TOKEN_PRIMARY,
    DISCORD_CLIENT_ID_PRIMARY: process.env.DISCORD_CLIENT_ID_PRIMARY
  };
  try {
    process.env.DISCORD_TOKEN = "primary-token";
    process.env.DISCORD_CLIENT_ID = "primary-client";
    delete process.env.DISCORD_TOKEN_PRIMARY;
    delete process.env.DISCORD_CLIENT_ID_PRIMARY;

    assert.deepEqual(resolveIdentityEnv("primary"), {
      token: "primary-token",
      clientId: "primary-client"
    });
  } finally {
    restoreEnv(old);
  }
});

test("secondary identities cannot fall back to primary credentials", () => {
  const old = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_TOKEN_MUSIC2: process.env.DISCORD_TOKEN_MUSIC2,
    DISCORD_CLIENT_ID_MUSIC2: process.env.DISCORD_CLIENT_ID_MUSIC2
  };
  try {
    process.env.DISCORD_TOKEN = "primary-token";
    process.env.DISCORD_CLIENT_ID = "primary-client";
    delete process.env.DISCORD_TOKEN_MUSIC2;
    delete process.env.DISCORD_CLIENT_ID_MUSIC2;

    assert.deepEqual(resolveIdentityEnv("music2"), {
      token: undefined,
      clientId: undefined
    });

    process.env.DISCORD_TOKEN_MUSIC2 = "music-token";
    process.env.DISCORD_CLIENT_ID_MUSIC2 = "music-client";
    assert.deepEqual(resolveIdentityEnv("music2"), {
      token: "music-token",
      clientId: "music-client"
    });
  } finally {
    restoreEnv(old);
  }
});

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}


test("bot identity encrypts credentials at rest and does not expose ciphertext as token", async () => {
  let stored: Record<string, unknown> | null = null;
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      if (text.startsWith("SELECT id,client_id,token_ciphertext,enabled")) {
        return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 } as { rows: T[]; rowCount: number };
      }
      if (text.startsWith("SELECT id,client_id AS") && text.includes("tokenConfigured")) {
        return {
          rows: stored ? [{
            id: stored.id,
            clientId: stored.client_id,
            enabled: stored.enabled,
            presenceName: stored.presence_name,
            tokenConfigured: Boolean(stored.token_ciphertext)
          }] : [],
          rowCount: stored ? 1 : 0
        } as { rows: T[]; rowCount: number };
      }
      if (text.startsWith("INSERT INTO bot_identities")) {
        stored = {
          id: String(values[0]),
          client_id: String(values[1]),
          enabled: values[2],
          presence_name: values[3],
          token_ciphertext: values[4]
        };
        return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
      }
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const repository = new (await import("../src/bot-identity.js")).BotIdentityRepository(db, "primary", "management-secret");
  const saved = await repository.saveSettings({
    clientId: "123456789012345678",
    token: "super-secret-bot-token",
    enabled: true,
    presenceName: "DSP"
  });
  assert.equal(saved.tokenConfigured, true);
  assert.equal(String(stored?.token_ciphertext).includes("super-secret-bot-token"), false);

  const credentials = await repository.credentials();
  assert.equal(credentials?.token, "super-secret-bot-token");
  assert.equal(credentials?.clientId, "123456789012345678");
});
