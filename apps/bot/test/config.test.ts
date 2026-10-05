import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const old: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function baseEnv(): Record<string, string> {
  return {
    NODE_ENV: "development",
    BOT_IDENTITY_ID: "primary",
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "123456789012345678",
    MANAGEMENT_API_KEY: "management-key",
    BOT_CREDENTIALS_ENCRYPTION_KEY: "ab".repeat(32),
    DATABASE_URL: "postgresql://localhost/test",
    LAVALINK_PASSWORD: "lavalink-password"
  };
}

test("Lavalink config falls back to the primary node when LAVALINK_NODES is empty", () => {
  withEnv({
    ...baseEnv(),
    LAVALINK_NODES: undefined,
    LAVALINK_HOST: "127.0.0.1",
    LAVALINK_PORT: "2333"
  }, () => {
    const config = loadConfig();
    assert.deepEqual(config.lavalinkNodes, [{
      id: "local",
      host: "127.0.0.1",
      port: 2333,
      password: "lavalink-password"
    }]);
  });
});

test("Lavalink config accepts an explicit two-node failover definition", () => {
  withEnv({
    ...baseEnv(),
    LAVALINK_NODES: JSON.stringify([
      { id: "local", host: "lavalink", port: 2333, password: "one" },
      { id: "local-2", host: "lavalink2", port: 2334, password: "two" }
    ])
  }, () => {
    const config = loadConfig();
    assert.equal(config.lavalinkNodes.length, 2);
    assert.equal(config.lavalinkNodes[1]?.id, "local-2");
    assert.equal(config.lavalinkNodes[1]?.port, 2334);
  });
});

test("production rejects a public Management API bind", () => {
  withEnv({
    ...baseEnv(),
    NODE_ENV: "production",
    MANAGEMENT_API_HOST: "0.0.0.0"
  }, () => {
    assert.throws(() => loadConfig(), /MANAGEMENT_API_HOST must be loopback/);
  });
});

test("production rejects non-HTTPS remote backups", () => {
  withEnv({
    ...baseEnv(),
    NODE_ENV: "production",
    BACKUP_S3_ENDPOINT: "http://backup.internal",
    BACKUP_S3_BUCKET: "dsp",
    BACKUP_S3_ACCESS_KEY_ID: "key",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret"
  }, () => {
    assert.throws(() => loadConfig(), /BACKUP_S3_ENDPOINT must use HTTPS/);
  });
});

test("production accepts loopback Management API and HTTPS backups", () => {
  withEnv({
    ...baseEnv(),
    NODE_ENV: "production",
    MANAGEMENT_API_HOST: "127.0.0.1",
    BACKUP_S3_ENDPOINT: "https://backup.internal",
    BACKUP_S3_BUCKET: "dsp",
    BACKUP_S3_ACCESS_KEY_ID: "key",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret"
  }, () => {
    const config = loadConfig();
    assert.equal(config.nodeEnv, "production");
    assert.equal(config.managementApiHost, "127.0.0.1");
    assert.equal(config.backupS3?.endpoint, "https://backup.internal");
  });
});

test("invalid ports are rejected", () => {
  withEnv({
    ...baseEnv(),
    MANAGEMENT_API_PORT: "70000"
  }, () => {
    assert.throws(() => loadConfig(), /Invalid port environment variable/);
  });
});


test("Discord credentials may be omitted for a DB-backed identity", () => {
  withEnv({
    ...baseEnv(),
    DISCORD_TOKEN: undefined,
    DISCORD_CLIENT_ID: undefined
  }, () => {
    const config = loadConfig();
    assert.equal(config.discordToken, "");
    assert.equal(config.discordClientId, "");
  });
});
