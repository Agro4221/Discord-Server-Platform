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
