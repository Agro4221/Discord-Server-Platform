import { Database } from "./database.js";

const migrations = [
  {
    version: 1,
    name: "initial",
    sql: q([
      "CREATE TABLE IF NOT EXISTS guild_settings (",
      "  guild_id text PRIMARY KEY,",
      "  temp_voice_enabled boolean NOT NULL DEFAULT false,",
      "  temp_voice_trigger_channel_id text,",
      "  temp_voice_category_id text,",
      "  temp_voice_default_limit integer NOT NULL DEFAULT 0,",
      "  temp_voice_private boolean NOT NULL DEFAULT false,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "",
      "CREATE TABLE IF NOT EXISTS temp_voice_rooms (",
      "  guild_id text NOT NULL,",
      "  channel_id text PRIMARY KEY,",
      "  owner_id text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "",
      "CREATE TABLE IF NOT EXISTS moderation_cases (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  target_user_id text NOT NULL,",
      "  moderator_user_id text NOT NULL,",
      "  action text NOT NULL,",
      "  reason text,",
      "  expires_at timestamptz,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "",
      "CREATE INDEX IF NOT EXISTS idx_temp_voice_rooms_guild ON temp_voice_rooms(guild_id);",
      "CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild_target ON moderation_cases(guild_id,target_user_id,created_at DESC);"
    ])
  },
  {
    version: 2,
    name: "guild_modules",
    sql: q([
      "CREATE TABLE IF NOT EXISTS guild_modules (",
      "  guild_id text NOT NULL,",
      "  module_key text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT false,",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,module_key)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_guild_modules_enabled ON guild_modules(guild_id,enabled);"
    ])
  },
  {
    version: 3,
    name: "audit_events",
    sql: q([
      "CREATE TABLE IF NOT EXISTS audit_events (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text,",
      "  actor_user_id text,",
      "  source text NOT NULL,",
      "  action text NOT NULL,",
      "  target_type text,",
      "  target_id text,",
      "  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_audit_events_guild_created ON audit_events(guild_id,created_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_audit_events_action_created ON audit_events(action,created_at DESC);"
    ])
  },
  {
    version: 4,
    name: "community_foundation",
    sql: q([
      "CREATE TABLE IF NOT EXISTS automod_settings (",
      "  guild_id text PRIMARY KEY,",
      "  enabled boolean NOT NULL DEFAULT false,",
      "  blocked_words text[] NOT NULL DEFAULT '{}',",
      "  max_mentions integer NOT NULL DEFAULT 6,",
      "  max_caps_ratio real NOT NULL DEFAULT 0.85,",
      "  max_repeated_messages integer NOT NULL DEFAULT 5,",
      "  repeated_window_seconds integer NOT NULL DEFAULT 10,",
      "  delete_message boolean NOT NULL DEFAULT true,",
      "  timeout_minutes integer NOT NULL DEFAULT 0,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS automod_events (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  message_id text NOT NULL,",
      "  rule text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_automod_events_guild_created ON automod_events(guild_id,created_at DESC);",
      "CREATE TABLE IF NOT EXISTS welcome_settings (",
      "  guild_id text PRIMARY KEY,",
      "  enabled boolean NOT NULL DEFAULT false,",
      "  channel_id text,",
      "  message text NOT NULL DEFAULT 'Добро пожаловать, {mention}, на {server}!',",
      "  dm boolean NOT NULL DEFAULT false,",
      "  embed boolean NOT NULL DEFAULT true,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS leveling_users (",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  xp bigint NOT NULL DEFAULT 0 CHECK(xp >= 0),",
      "  level integer NOT NULL DEFAULT 0 CHECK(level >= 0),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,user_id)",
      ");"
    ])
  },
  {
    version: 5,
    name: "support_community",
    sql: q([
      "CREATE TABLE IF NOT EXISTS ticket_settings (",
      "  guild_id text PRIMARY KEY,",
      "  enabled boolean NOT NULL DEFAULT false,",
      "  category_id text, staff_role_id text, transcript_channel_id text,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS tickets (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  channel_id text NOT NULL UNIQUE,",
      "  creator_id text NOT NULL,",
      "  claimed_by text,",
      "  status text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  closed_at timestamptz",
      ");",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_open_ticket_per_creator ON tickets(guild_id,creator_id) WHERE status='open';",
      "CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id,status);",
      "CREATE TABLE IF NOT EXISTS ticket_transcripts (",
      "  ticket_id bigint PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,",
      "  guild_id text NOT NULL, content text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS role_panels (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, channel_id text NOT NULL,",
      "  message_id text, title text NOT NULL, roles jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_role_panels_guild ON role_panels(guild_id);",
      "CREATE TABLE IF NOT EXISTS giveaways (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, channel_id text NOT NULL,",
      "  message_id text UNIQUE, host_user_id text NOT NULL, prize text NOT NULL,",
      "  winners integer NOT NULL CHECK(winners > 0 AND winners <= 100),",
      "  ends_at timestamptz NOT NULL, status text NOT NULL, selected_winners jsonb,",
      "  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_giveaways_running ON giveaways(status,ends_at);",
      "CREATE TABLE IF NOT EXISTS giveaway_entries (",
      "  giveaway_id bigint NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,",
      "  user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(giveaway_id,user_id)",
      ");",
      "CREATE TABLE IF NOT EXISTS economy_accounts (",
      "  guild_id text NOT NULL, user_id text NOT NULL,",
      "  balance bigint NOT NULL DEFAULT 0 CHECK(balance >= 0),",
      "  last_daily timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,user_id)",
      ");"
    ])
  },
  {
    version: 6,
    name: "automation_and_utilities",
    sql: q([
      "CREATE TABLE IF NOT EXISTS reminders (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL,",
      "  channel_id text, content text NOT NULL, due_at timestamptz NOT NULL,",
      "  delivered_at timestamptz, delivery_attempts integer NOT NULL DEFAULT 0,",
      "  last_error text, created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(delivered_at,due_at);",
      "CREATE TABLE IF NOT EXISTS starboard_settings (",
      "  guild_id text PRIMARY KEY, channel_id text NOT NULL,",
      "  threshold integer NOT NULL DEFAULT 3 CHECK(threshold > 0 AND threshold <= 100),",
      "  ignore_self_reaction boolean NOT NULL DEFAULT true,",
      "  ignore_bots boolean NOT NULL DEFAULT true,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS starboard_entries (",
      "  guild_id text NOT NULL, source_message_id text NOT NULL, starboard_message_id text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,source_message_id)",
      ");",
      "CREATE TABLE IF NOT EXISTS automation_rules (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, name text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT true, event text NOT NULL,",
      "  conditions jsonb NOT NULL DEFAULT '[]'::jsonb, actions jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  cooldown_seconds integer NOT NULL DEFAULT 0,",
      "  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_automation_rules_guild_enabled ON automation_rules(guild_id,enabled);"
    ])
  },
  {
    version: 7,
    name: "security_notifications",
    sql: q([
      "CREATE TABLE IF NOT EXISTS security_settings (",
      "  guild_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,",
      "  max_joins integer NOT NULL DEFAULT 10, window_seconds integer NOT NULL DEFAULT 20,",
      "  quarantine_role_id text, log_channel_id text, updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS security_events (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, event_type text NOT NULL,",
      "  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_security_events_guild_created ON security_events(guild_id,created_at DESC);",
      "CREATE TABLE IF NOT EXISTS notification_feeds (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, channel_id text NOT NULL, url text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT true, interval_seconds integer NOT NULL DEFAULT 300 CHECK(interval_seconds BETWEEN 60 AND 86400),",
      "  last_item_key text, last_polled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_feed_guild_url ON notification_feeds(guild_id,url);"
    ])
  },
  {
    version: 8,
    name: "music",
    sql: q([
      "CREATE TABLE IF NOT EXISTS music_settings (",
      "  guild_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,",
      "  preferred_text_channel_id text, default_volume integer NOT NULL DEFAULT 100 CHECK(default_volume BETWEEN 0 AND 200),",
      "  announce_track_start boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS music_players (",
      "  guild_id text NOT NULL, bot_identity_id text NOT NULL, voice_channel_id text, text_channel_id text,",
      "  state jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,bot_identity_id)",
      ");",
      "CREATE TABLE IF NOT EXISTS music_queue_store (",
      "  guild_id text NOT NULL, bot_identity_id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,bot_identity_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_music_players_identity ON music_players(bot_identity_id);"
    ])
  }
  },
  {
    version: 9,
    name: "verification_analytics",
    sql: q([
      "CREATE TABLE IF NOT EXISTS verification_settings (",
      "  guild_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,",
      "  channel_id text, verified_role_id text, log_channel_id text,",
      "  code_ttl_minutes integer NOT NULL DEFAULT 10 CHECK(code_ttl_minutes BETWEEN 2 AND 60),",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS analytics_events (",
      "  guild_id text NOT NULL, event_type text NOT NULL,",
      "  bucket_start timestamptz NOT NULL, count bigint NOT NULL DEFAULT 0,",
      "  PRIMARY KEY(guild_id,event_type,bucket_start)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_analytics_events_guild_bucket ON analytics_events(guild_id,bucket_start DESC);"
    ])
  }
  },
  {
    version: 10,
    name: "leveling_settings",
    sql: q([
      "CREATE TABLE IF NOT EXISTS leveling_settings (",
      "  guild_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,",
      "  xp_per_message integer NOT NULL DEFAULT 10 CHECK(xp_per_message BETWEEN 1 AND 1000),",
      "  cooldown_seconds integer NOT NULL DEFAULT 30 CHECK(cooldown_seconds BETWEEN 0 AND 3600),",
      "  announce_level_up boolean NOT NULL DEFAULT true,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");"
    ])
  }
  },
  {
    version: 11,
    name: "bot_identities",
    sql: q([
      "CREATE TABLE IF NOT EXISTS bot_identities (",
      "  id text PRIMARY KEY,",
      "  client_id text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT true,",
      "  presence_name text,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE TABLE IF NOT EXISTS guild_bot_assignments (",
      "  guild_id text PRIMARY KEY,",
      "  bot_identity_id text NOT NULL REFERENCES bot_identities(id) ON DELETE RESTRICT,",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");"
    ])
  }
] as const;

export async function migrate(db: Database): Promise<void> {
  await db.query(q([
    "CREATE TABLE IF NOT EXISTS schema_migrations (",
    "  version integer PRIMARY KEY,",
    "  name text NOT NULL,",
    "  applied_at timestamptz NOT NULL DEFAULT now()",
    ")"
  ]));

  await db.query("SELECT pg_advisory_lock(hashtext('discord-server-platform:migrations'))");

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
