import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

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
  "LAVALINK_PASSWORD"
];

for (const name of requiredEnv) {
  if (!envExample.split("\n").some((line) => line.startsWith(name + "="))) {
    throw new Error("Missing env contract entry: " + name);
  }
}

if (!envExample.includes("DISCORD_TOKEN_MUSIC2") || !envExample.includes("DISCORD_CLIENT_ID_MUSIC2")) {
  throw new Error("Secondary Discord credential contract is not documented");
}

const vpsInstaller = await readFile("scripts/install-vps.sh", "utf8");
const vpsUpgrade = await readFile("scripts/upgrade.sh", "utf8");
const vpsCompose = await readFile("docker-compose.vps.yml", "utf8");
const caddyExample = await readFile("infrastructure/caddy/Caddyfile.example", "utf8");
const gitignore = await readFile(".gitignore", "utf8");

if (vpsInstaller.includes("DASHBOARD_ADMIN_PASSWORD")) {
  throw new Error("Legacy Dashboard admin password flow is still present in VPS installer");
}
for (const contract of ["DASHBOARD_BASIC_AUTH_HASH", "docker-compose.vps.yml", "caddy:2-alpine"]) {
  if (!vpsInstaller.includes(contract) && !vpsUpgrade.includes(contract) && !vpsCompose.includes(contract)) {
    throw new Error("VPS deployment contract missing: " + contract);
  }
}
for (const contract of ['"80:80"', '"443:443"', "dashboard:3000"]) {
  if (!vpsCompose.includes(contract)) {
    throw new Error("Public Caddy ingress contract missing: " + contract);
  }
}
if (!caddyExample.includes("basic_auth") || !caddyExample.includes("reverse_proxy dashboard:3000")) {
  throw new Error("Caddy public ingress example is not protected and proxied correctly");
}
if (!gitignore.includes("infrastructure/caddy/Caddyfile")) {
  throw new Error("Generated Caddy credentials file is not ignored");
}
try {
  execFileSync("bash", ["-n", "scripts/install-vps.sh"], { stdio: "pipe" });
  execFileSync("bash", ["-n", "scripts/upgrade.sh"], { stdio: "pipe" });
} catch {
  throw new Error("VPS shell scripts failed bash -n validation");
}

try {
  execFileSync("docker", ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.vps.yml", "config"], {
    stdio: "pipe",
    env: { ...process.env, DOMAIN: "panel.example.com", DASHBOARD_BASIC_AUTH_USER: "admin", DASHBOARD_BASIC_AUTH_HASH: "$argon2id$dummy" }
  });
} catch {
  throw new Error("VPS Compose overlay failed config validation");
}

const localLauncher = await readFile("scripts/start-local.ps1", "utf8");
for (const contract of [
  "docker compose up -d",
  "MANAGEMENT_API_KEY",
  "Control Center",
  "Bot Fleet",
  "127.0.0.1",
  "Start-Process"
]) {
  if (!localLauncher.includes(contract)) {
    throw new Error("Local launcher contract missing: " + contract);
  }
}

console.log("Deployment contract passed.");
