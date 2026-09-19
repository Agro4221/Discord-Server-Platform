import type { Database } from "./database.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";

const ENABLE_COLUMNS: Partial<Record<ModuleKey, [string, string]>> = {
  "temporary-voice": ["guild_settings", "temp_voice_enabled"],
  automod: ["automod_settings", "enabled"],
  security: ["security_settings", "enabled"],
  welcome: ["welcome_settings", "enabled"],
  verification: ["verification_settings", "enabled"],
  tickets: ["ticket_settings", "enabled"],
  music: ["music_settings", "enabled"]
};

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
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO guild_modules(guild_id,module_key,enabled)
         VALUES($1,$2,$3)
         ON CONFLICT(guild_id,module_key)
         DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
        [guildId, moduleKey, enabled]
      );

      const mapping = ENABLE_COLUMNS[moduleKey];
      if (!mapping) return;

      await this.ensureRuntimeRow(client, guildId, moduleKey);

      const [table, column] = mapping;
      await client.query(
        `UPDATE "${table}" SET "${column}"=$1,updated_at=now() WHERE guild_id=$2`,
        [enabled, guildId]
      );
    });
  }

  async isEnabled(guildId: string, moduleKey: ModuleKey): Promise<boolean> {
    await this.ensureGuild(guildId);
    const result = await this.db.query<{ enabled: boolean }>(
      "SELECT enabled FROM guild_modules WHERE guild_id=$1 AND module_key=$2",
      [guildId, moduleKey]
    );
    return result.rows[0]?.enabled ?? false;
  }

  async list(guildId: string): Promise<Record<ModuleKey, boolean>> {
    await this.ensureGuild(guildId);
    const result = await this.db.query<{ module_key: ModuleKey; enabled: boolean }>(
      "SELECT module_key,enabled FROM guild_modules WHERE guild_id=$1 ORDER BY module_key",
      [guildId]
    );
    return Object.fromEntries(result.rows.map((row) => [row.module_key, row.enabled])) as Record<ModuleKey, boolean>;
  }

  private async ensureRuntimeRow(
    client: import("pg").PoolClient,
    guildId: string,
    moduleKey: ModuleKey
  ): Promise<void> {
    switch (moduleKey) {
      case "temporary-voice":
        await client.query(
          "INSERT INTO guild_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "automod":
        await client.query(
          "INSERT INTO automod_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "security":
        await client.query(
          "INSERT INTO security_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "welcome":
        await client.query(
          "INSERT INTO welcome_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "verification":
        await client.query(
          "INSERT INTO verification_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "tickets":
        await client.query(
          "INSERT INTO ticket_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "music":
        await client.query(
          "INSERT INTO music_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING",
          [guildId]
        );
        break;
      case "starboard":
        break;
      default:
        break;
    }
  }
}
