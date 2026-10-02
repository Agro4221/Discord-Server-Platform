type Meta = Record<string, unknown>;

const REDACT_KEYS = new Set([
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "apikey",
  "accesskey",
  "access_key",
  "secretaccesskey",
  "secret_access_key",
  "managementapikey",
  "management_api_key",
  "discordtoken",
  "discord_token",
  "lavallinkpassword",
  "lavalink_password",
  "dashboardsessionsecret",
  "dashboard_session_secret",
  "dashboardadminpassword",
  "dashboard_admin_password"
]);

const MAX_STRING = 2_000;
const MAX_DEPTH = 5;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";

  if (typeof value === "string") {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…[truncated]" : value;
  }

  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: safeValue(value.message, depth + 1),
      stack: typeof value.stack === "string" ? safeValue(value.stack, depth + 1) : undefined
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => safeValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (REDACT_KEYS.has(normalizeKey(key))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = safeValue(item, depth + 1);
      }
    }
    return result;
  }

  return value;
}

export function sanitizeMeta(meta: Meta): Meta {
  return safeValue(meta) as Meta;
}

function write(level: "INFO" | "WARN" | "ERROR", message: string, meta?: Meta): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: sanitizeMeta(meta) } : {})
  };
  const line = JSON.stringify(payload);
  if (level === "ERROR") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, meta?: Meta) => write("INFO", message, meta),
  warn: (message: string, meta?: Meta) => write("WARN", message, meta),
  error: (message: string, meta?: Meta) => write("ERROR", message, meta)
};
