import type { Database } from "./database.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";

export class ModuleSettingsRepository {
  constructor(private readonly db: Database) {}

  async ensureGuild(guildId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      for (const module of MODULE_CATALOG) {
        await client.query(
          `INSERT INTO guild_modules(guild_id,module_key,enabled)
           VALUES($1,$2,$3)
           ON CONFLICT(guild_id,module_key) DO NOTHING`,
          [guildId, module.key, module.defaultEnabled]
        );
      }
    });
  }

  async set(guildId: string, moduleKey: ModuleKey, enabled: boolean): Promise<void> {
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,$2,$3)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()`,
      [guildId, moduleKey, enabled]
    );
  }

  async list(guildId: string): Promise<Record<ModuleKey, boolean>> {
    await this.ensureGuild(guildId);
    const result = await this.db.query<{ module_key: ModuleKey; enabled: boolean }>(
      "SELECT module_key,enabled FROM guild_modules WHERE guild_id=$1",
      [guildId]
    );

    return Object.fromEntries(result.rows.map((row) => [row.module_key, row.enabled])) as Record<ModuleKey, boolean>;
  }
}
