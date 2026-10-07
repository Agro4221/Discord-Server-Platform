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
    DATABASE_URL: "postgresql://localhost/test"
  };
}

test("Music tooling config uses yt-dlp and FFmpeg defaults", () => {
  withEnv({
    ...baseEnv(),
    YTDLP_PATH: undefined,
    FFMPEG_PATH: undefined,
    YTDLP_JS_RUNTIME: undefined,
    YTDLP_COOKIES_FILE: undefined
  }, () => {
    const config = loadConfig();
    assert.equal(config.ytDlpPath, "yt-dlp");
    assert.equal(config.ffmpegPath, "ffmpeg");
    assert.equal(config.ytDlpJsRuntime, "node");
    assert.equal(config.ytDlpCookiesFile, undefined);
  });
});

test("Music tooling config accepts explicit executable paths and cookies", () => {
  withEnv({
    ...baseEnv(),
    YTDLP_PATH: "C:\\tools\\yt-dlp.exe",
    FFMPEG_PATH: "C:\\ffmpeg\\bin\\ffmpeg.exe",
    YTDLP_JS_RUNTIME: "deno",
    YTDLP_COOKIES_FILE: "C:\\tools\\cookies.txt"
  }, () => {
    const config = loadConfig();
    assert.equal(config.ytDlpPath, "C:\\tools\\yt-dlp.exe");
    assert.equal(config.ffmpegPath, "C:\\ffmpeg\\bin\\ffmpeg.exe");
    assert.equal(config.ytDlpJsRuntime, "deno");
    assert.equal(config.ytDlpCookiesFile, "C:\\tools\\cookies.txt");
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
