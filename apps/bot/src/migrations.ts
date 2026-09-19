import { Database } from "./database.js";

const migrations = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id text PRIMARY KEY,
        temp_voice_enabled boolean NOT NULL DEFAULT false,
        temp_voice_trigger_channel_id text,
        temp_voice_category_id text,
        temp_voice_default_limit integer NOT NULL DEFAULT 0,
        temp_voice_private boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS temp_voice_rooms (
        guild_id text NOT NULL,
        channel_id text PRIMARY KEY,
        owner_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS moderation_cases (
        id bigserial PRIMARY KEY,
        guild_id text NOT NULL,
        target_user_id text NOT NULL,
        moderator_user_id text NOT NULL,
        action text NOT NULL,
        reason text,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_temp_voice_rooms_guild
        ON temp_voice_rooms(guild_id);
      CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild_target
        ON moderation_cases(guild_id, target_user_id, created_at DESC);
    `
  },
  {
    version: 2,
    name: "guild_modules",
    sql: `
      CREATE TABLE IF NOT EXISTS guild_modules (
        guild_id text NOT NULL,
        module_key text NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(guild_id, module_key)
      );

      CREATE INDEX IF NOT EXISTS idx_guild_modules_enabled
        ON guild_modules(guild_id, enabled);
    `
  },
  {
    version: 3,
    name: "audit_events",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        id bigserial PRIMARY KEY,
        guild_id text,
        actor_user_id text,
        source text NOT NULL,
        action text NOT NULL,
        target_type text,
        target_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_guild_created
        ON audit_events(guild_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_action_created
        ON audit_events(action, created_at DESC);
    `
  }
] as const;

export async function migrate(db: Database): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.query(
    "SELECT pg_advisory_lock(hashtext('discord-server-platform:migrations'))"
  );

  try {
    const result = await db.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const applied = new Set(result.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      await db.transaction(async (client) => {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
          [migration.version, migration.name]
        );
      });
    }
  } finally {
    await db.query(
      "SELECT pg_advisory_unlock(hashtext('discord-server-platform:migrations'))"
    );
  }
}
