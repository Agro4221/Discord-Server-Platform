import { readFile } from "node:fs/promises";

const migrationSource = await readFile("apps/bot/src/migrations.ts", "utf8");
const versions = [...migrationSource.matchAll(/version:\s*(\d+)/g)]
  .map((match) => Number(match[1]))
  .sort((a, b) => a - b);

if (!versions.length || versions.some((version, index) => version !== index + 1)) {
  throw new Error("Migration versions must be contiguous starting at 1");
}

const envExample = await readFile(".env.example", "utf8");
const requiredEnv = [
  "MANAGEMENT_API_KEY",
  "DATABASE_URL",
  "LAVALINK_PASSWORD",
  "DASHBOARD_SESSION_SECRET",
  "DASHBOARD_ADMIN_PASSWORD"
];

for (const name of requiredEnv) {
  if (!envExample.split("\n").some((line) => line.startsWith(name + "="))) {
    throw new Error("Missing env contract entry: " + name);
  }
}

if (!envExample.includes("DISCORD_TOKEN_MUSIC2") || !envExample.includes("DISCORD_CLIENT_ID_MUSIC2")) {
  throw new Error("Secondary Discord credential contract is not documented");
}

const localLauncher = await readFile("scripts/start-local.ps1", "utf8");
for (const contract of [
  "docker compose up -d",
  '"compose", "up", "-d"',
  "DASHBOARD_ADMIN_PASSWORD",
  "MANAGEMENT_API_KEY",
  "DASHBOARD_SESSION_SECRET",
  "127.0.0.1",
  "Start-Process"
]) {
  if (!localLauncher.includes(contract)) {
    throw new Error("Local launcher contract missing: " + contract);
  }
}

console.log("Deployment contract passed.");
