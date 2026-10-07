import type { Database } from "./database.js";
import type { ModuleKey } from "./modules/catalog.js";

type ModuleEnabledCacheEntry = {
  enabled: boolean;
  expiresAt: number;
};

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 25_000;
const PRUNE_EVERY = 512;
const moduleEnabledCache = new Map<string, ModuleEnabledCacheEntry>();
const moduleEnabledInflight = new Map<string, Promise<boolean>>();
let cacheReads = 0;

export async function moduleEnabled(
  db: Database,
  guildId: string,
  key: ModuleKey,
  defaultEnabled = false
): Promise<boolean> {
  const now = Date.now();
  const cacheKey = `${guildId}:${key}:${defaultEnabled ? "1" : "0"}`;
  const cached = moduleEnabledCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.enabled;
  }

  const existing = moduleEnabledInflight.get(cacheKey);
  if (existing) return existing;

  const load = (async (): Promise<boolean> => {
    try {
      const result = await db.query<{ enabled: boolean }>(
        "SELECT enabled FROM guild_modules WHERE guild_id=$1 AND module_key=$2",
        [guildId, key]
      );
      const enabled = result.rows[0]?.enabled ?? defaultEnabled;

      moduleEnabledCache.set(cacheKey, {
        enabled,
        expiresAt: now + CACHE_TTL_MS
      });

      cacheReads += 1;
      if (cacheReads % PRUNE_EVERY === 0 || moduleEnabledCache.size > MAX_CACHE_ENTRIES) {
        pruneModuleEnabledCache(Date.now());
      }

      return enabled;
    } finally {
      moduleEnabledInflight.delete(cacheKey);
    }
  })();

  moduleEnabledInflight.set(cacheKey, load);
  return load;
}

export function clearModuleEnabledCache(guildId?: string, key?: ModuleKey): void {
  if (!guildId && !key) {
    moduleEnabledCache.clear();
    moduleEnabledInflight.clear();
    return;
  }

  for (const cacheKey of moduleEnabledCache.keys()) {
    const [cachedGuildId, cachedKey] = cacheKey.split(":");
    if (guildId && cachedGuildId !== guildId) continue;
    if (key && cachedKey !== key) continue;
    moduleEnabledCache.delete(cacheKey);
  }
}

function pruneModuleEnabledCache(now: number): void {
  for (const [key, entry] of moduleEnabledCache) {
    if (entry.expiresAt <= now) moduleEnabledCache.delete(key);
  }

  if (moduleEnabledCache.size <= MAX_CACHE_ENTRIES) return;

  const oldest = [...moduleEnabledCache.entries()]
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(0, moduleEnabledCache.size - MAX_CACHE_ENTRIES);

  for (const [key] of oldest) moduleEnabledCache.delete(key);
}

export function renderTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/{([a-zA-Z0-9_]+)}/g, (match, key: string) => values[key] ?? match);
}
