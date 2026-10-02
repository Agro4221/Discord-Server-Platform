import type { Database } from "./database.js";
import type { ModuleKey } from "./modules/catalog.js";

export async function moduleEnabled(
  db: Database,
  guildId: string,
  key: ModuleKey,
  defaultEnabled = false
): Promise<boolean> {
  const result = await db.query<{ enabled: boolean }>(
    "SELECT enabled FROM guild_modules WHERE guild_id=$1 AND module_key=$2",
    [guildId, key]
  );
  return result.rows[0]?.enabled ?? defaultEnabled;
}

export function renderTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/{([a-zA-Z0-9_]+)}/g, (match, key: string) => values[key] ?? match);
}
