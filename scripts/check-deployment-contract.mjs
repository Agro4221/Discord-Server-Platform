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
const dockerCompose = await readFile("docker-compose.yml", "utf8");
const lavalinkConfig = await readFile("infrastructure/lavalink/application.yml", "utf8");
if (
  lavalinkConfig.includes("change-me-local") ||
  !lavalinkConfig.includes('password: "${LAVALINK_SERVER_PASSWORD}"')
) {
  throw new Error("Lavalink password must come from the explicit environment secret");
}
const healthSource = await readFile("apps/bot/src/health.ts", "utf8");
if (
  !healthSource.includes('path === "/health"') ||
  !healthSource.includes('path === "/ready"') ||
  !healthSource.includes('state.database === "ready"')
) {
  throw new Error("Health liveness/readiness contract is missing");
}

if (!dockerCompose.includes("MANAGEMENT_API_PORT: 3002") || !dockerCompose.includes('MANAGEMENT_API_URL: http://bot:3002')) {
  throw new Error("Container-internal Management API port contract is missing");
}

for (const insecureDefault of ["change-me-postgres", "change-me-local"]) {
  if (dockerCompose.includes(insecureDefault)) {
    throw new Error("Insecure Compose secret fallback is still present: " + insecureDefault);
  }
}


if (vpsInstaller.includes("cp infrastructure/caddy/Caddyfile.example infrastructure/caddy/Caddyfile")) {
  throw new Error("VPS installer must not overwrite an existing Caddyfile");
}
if (!vpsInstaller.includes("if [[ ! -f infrastructure/caddy/Caddyfile ]]")) {
  throw new Error("VPS installer must preserve an existing Caddyfile");
}
if (vpsInstaller.includes("DASHBOARD_ADMIN_PASSWORD")) {
  throw new Error("Legacy Dashboard admin password flow is still present in VPS installer");
}
for (const contract of ["DASHBOARD_BASIC_AUTH_HASH", "docker-compose.vps.yml", "caddy:2-alpine"]) {
  if (!vpsInstaller.includes(contract) && !vpsUpgrade.includes(contract) && !vpsCompose.includes(contract)) {
    throw new Error("VPS deployment contract missing: " + contract);
  }
}
for (const contract of ['"80:80"', '"443:443"', "dashboard:3000"]) {
  if (!vpsCompose.includes(contract) && !caddyExample.includes(contract)) {
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
    env: { ...process.env, DOMAIN: "panel.example.com", DASHBOARD_BASIC_AUTH_USER: "admin", DASHBOARD_BASIC_AUTH_HASH: "$argon2id$dummy", POSTGRES_PASSWORD: "contract-postgres-password", LAVALINK_PASSWORD: "contract-lavalink-password", MANAGEMENT_API_KEY: "contract-management-api-key" }
  });
} catch {
  throw new Error("VPS Compose overlay failed config validation");
}

for (const runtimeContract of [
  "dashboard_code",
  "caddy_code",
  "http_code",
  "--resolve",
  '== "200"',
  '== "401"'
]) {
  if (!vpsInstaller.includes(runtimeContract) && !vpsUpgrade.includes(runtimeContract)) {
    throw new Error("VPS runtime smoke-check contract missing: " + runtimeContract);
  }
}

for (const secretContract of [
  "get_env()",
  "is_blank()",
  "ensure_secret()",
  "ensure_secret MANAGEMENT_API_KEY",
  "ensure_secret POSTGRES_PASSWORD",
  "ensure_secret LAVALINK_PASSWORD"
]) {
  if (!vpsInstaller.includes(secretContract)) {
    throw new Error("VPS secret-preservation contract missing: " + secretContract);
  }
}

for (const upgradeContract of [
  "is_blank()",
  "Required secret is missing from .env",
  "for required_secret in MANAGEMENT_API_KEY POSTGRES_PASSWORD LAVALINK_PASSWORD"
]) {
  if (!vpsUpgrade.includes(upgradeContract)) {
    throw new Error("VPS upgrade secret guard missing: " + upgradeContract);
  }
}

for (const upgradeDomainContract of [
  "DOMAIN is missing or invalid in .env.",
  'DOMAIN" =~ ^[A-Za-z0-9.-]+$'
]) {
  if (!vpsUpgrade.includes(upgradeDomainContract)) {
    throw new Error("VPS upgrade domain guard missing: " + upgradeDomainContract);
  }
}

for (const caddyUpgradeContract of [
  "Required Caddy setting is missing from .env: ${required_caddy_value}",
  "for required_caddy_value in DOMAIN DASHBOARD_BASIC_AUTH_USER DASHBOARD_BASIC_AUTH_HASH"
]) {
  if (!vpsUpgrade.includes(caddyUpgradeContract)) {
    throw new Error("VPS upgrade Caddy guard missing: " + caddyUpgradeContract);
  }
}

const nativeLauncher = await readFile("scripts/start-native.ps1", "utf8");
const nativeEntry = await readFile("start.bat", "utf8");
const nativeDashboardEntry = await readFile("control-center.bat", "utf8");
const nativeStopEntry = await readFile("stop.bat", "utf8");
const nativeStatusEntry = await readFile("native-status.bat", "utf8");
for (const contract of [
  "Control Center -> Bot Fleet can register them",
  "MANAGEMENT_API_URL = \"http://127.0.0.1:$managementApiPort\"",
  "Rotate-Log",
  "BOT_NODE_MAX_OLD_SPACE_MB",
  "DASHBOARD_NODE_MAX_OLD_SPACE_MB",
  "start:native",
  "127.0.0.1"
]) {
  if (!nativeLauncher.includes(contract)) {
    throw new Error("Native launcher contract missing: " + contract);
  }
}
if (nativeLauncher.includes('Read-Host "Discord bot token"') || nativeLauncher.includes('Read-Host "Discord client ID"')) {
  throw new Error("Native launcher must not require Discord credentials before Control Center startup");
}
if (nativeEntry.includes("docker") || !nativeEntry.includes("start-native.bat")) {
  throw new Error("start.bat must be a native launcher alias");
}
if (!nativeDashboardEntry.includes("-Dashboard") || !nativeStopEntry.includes("-Down") || !nativeStatusEntry.includes("native-status.ps1")) {
  throw new Error("Native convenience entrypoints are incomplete");
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
