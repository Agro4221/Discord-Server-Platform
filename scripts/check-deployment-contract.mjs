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
  "BOT_CREDENTIALS_ENCRYPTION_KEY",
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

const localLauncher = await readFile("scripts/start-local.ps1", "utf8");
for (const contract of [
  "docker compose up -d",
  "MANAGEMENT_API_KEY",
  "127.0.0.1",
  "Start-Process"
]) {
  if (!localLauncher.includes(contract)) {
    throw new Error("Local launcher contract missing: " + contract);
  }
}

const dashboardClient = await readFile("apps/dashboard/app/dashboard-client.tsx", "utf8");
for (const forbidden of [
  "async function logout",
  "/api/auth/logout",
  'window.location.href = "/login"',
  ">Выйти<"
]) {
  if (dashboardClient.includes(forbidden)) {
    throw new Error("Dashboard must not expose legacy end-user auth: " + forbidden);
  }
}

const nativeReleaseGate = await readFile("scripts/release-gate-native.ps1", "utf8");
for (const expected of [
  "native Fleet supervisor",
  "fleet.pid",
  '($identity.id + ".pid")',
  "NATIVE RELEASE GATE PASSED"
]) {
  if (!nativeReleaseGate.includes(expected)) {
    throw new Error("Native release-gate contract missing: " + expected);
  }
}

console.log("Deployment contract passed.");

const fleetSupervisor = await readFile("scripts/reconcile-fleet.ps1", "utf8");
for (const contract of [
  "api/fleet",
  "docker compose run",
  "--no-deps",
  "BOT_IDENTITY_ID",
  "dsp-bot-fleet-",
  "fleet-reconciler.log",
  "ERROR management API unavailable",
  "exit 1"
]) {
  if (!fleetSupervisor.includes(contract)) {
    throw new Error("Local fleet reconciler contract missing: " + contract);
  }
}
if (!localLauncher.includes("reconcile-fleet.ps1")) {
  throw new Error("Local launcher must reconcile the registered Bot Fleet");
}

const nativeLauncher = await readFile("scripts/start-native.ps1", "utf8");
for (const expected of [
  "BOT_CREDENTIALS_ENCRYPTION_KEY",
  "reconcile-fleet-native.ps1",
  "MANAGEMENT_API_URL = \"http://127.0.0.1:$managementPort\""
]) {
  if (!nativeLauncher.includes(expected)) {
    throw new Error("Native launcher contract missing: " + expected);
  }
}
for (const forbidden of [
  "DASHBOARD_SESSION_SECRET",
  "DASHBOARD_AUTH_REQUIRED"
]) {
  if (nativeLauncher.includes(forbidden)) {
    throw new Error("Native launcher must not recreate removed Dashboard auth state: " + forbidden);
  }
}

const nativeFleet = await readFile("scripts/reconcile-fleet-native.ps1", "utf8");
for (const expected of [
  "api/fleet",
  "BOT_IDENTITY_ID",
  ".native-runtime",
  "Start-Process",
  "taskkill.exe",
  "[switch]$Loop",
  "[switch]$Down",
  "ERROR management API unavailable"
]) {
  if (!nativeFleet.includes(expected)) {
    throw new Error("Native Fleet reconciler contract missing: " + expected);
  }
}

const releaseGate = await readFile("scripts/release-gate.ps1", "utf8");
for (const contract of [
  "Get-EnvValue",
  "docker compose ps",
  "/health",
  "/api/fleet",
  "unauthenticated",
  "restartRequired",
  "credentialConfigured",
  "dsp-bot-fleet-",
  "Docker Compose service inventory is available",
  "Assert-ContainerHealthy",
  "docker inspect --format",
  "Docker healthcheck is healthy",
  "RELEASE GATE PASSED"
]) {
  if (!releaseGate.includes(contract)) {
    throw new Error("Local release-gate contract missing: " + contract);
  }
}

for (const forbidden of [
  "docker compose up",
  "docker compose down",
  "Start-Process",
  "Set-EnvValue"
]) {
  if (releaseGate.includes(forbidden)) {
    throw new Error("Local release-gate must remain non-destructive; found: " + forbidden);
  }
}

const nativeDiagnostics = await readFile("scripts/native-diagnostics.ps1", "utf8");
for (const expected of [
  "runtime = \"native-windows\"",
  "managementUnauthenticated",
  "Credentials are not printed",
  "ConvertTo-Json",
  "Get-PidSnapshot"
]) {
  if (!nativeDiagnostics.includes(expected)) {
    throw new Error("Native diagnostics contract missing: " + expected);
  }
}
