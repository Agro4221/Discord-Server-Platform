import { Database } from "./database.js";

const q = (lines: readonly string[]): string => lines.join("\n");

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
  },
  {
    version: 12,
    name: "economy_shop",
    sql: q([
      "CREATE TABLE IF NOT EXISTS economy_shop_items (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, name text NOT NULL,",
      "  description text NOT NULL, price bigint NOT NULL CHECK(price > 0),",
      "  role_id text, stock integer CHECK(stock IS NULL OR stock >= 0),",
      "  enabled boolean NOT NULL DEFAULT true,",
      "  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_economy_shop_guild_enabled ON economy_shop_items(guild_id,enabled);",
      "CREATE TABLE IF NOT EXISTS economy_transactions (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL,",
      "  type text NOT NULL, amount bigint NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_economy_transactions_guild_user ON economy_transactions(guild_id,user_id,created_at DESC);"
    ])
  },
  {
    version: 13,
    name: "security_destructive_thresholds",
    sql: q([
      "ALTER TABLE security_settings ADD COLUMN IF NOT EXISTS max_destructive_actions integer NOT NULL DEFAULT 5;",
      "ALTER TABLE security_settings ADD COLUMN IF NOT EXISTS destructive_window_seconds integer NOT NULL DEFAULT 20;"
    ])
  },
  {
    version: 14,
    name: "reminder_processing_lease",
    sql: q([
      "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS processing_until timestamptz;"
    ])
  }
,
  {
    version: 15,
    name: "bot_heartbeats",
    sql: q([
      "CREATE TABLE IF NOT EXISTS bot_heartbeats (",
      "  bot_identity_id text PRIMARY KEY REFERENCES bot_identities(id) ON DELETE CASCADE,",
      "  status text NOT NULL CHECK(status IN ('starting','ready','degraded','stopped')),",
      "  last_seen_at timestamptz NOT NULL DEFAULT now(),",
      "  guild_count integer NOT NULL DEFAULT 0 CHECK(guild_count >= 0)",
      ");"
    ])
  },
  {
    version: 16,
    name: "music_node_sessions",
    sql: q([
      "CREATE TABLE IF NOT EXISTS music_node_sessions (",
      "  bot_identity_id text NOT NULL REFERENCES bot_identities(id) ON DELETE CASCADE,",
      "  node_id text NOT NULL,",
      "  session_id text NOT NULL,",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(bot_identity_id,node_id)",
      ");"
    ])
  },
  {
    version: 17,
    name: "automod_extended_rules",
    sql: q([
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS block_links boolean NOT NULL DEFAULT false;",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS block_invites boolean NOT NULL DEFAULT false;",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS max_links integer NOT NULL DEFAULT 3;",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS max_emojis integer NOT NULL DEFAULT 20;",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS max_line_length integer NOT NULL DEFAULT 1000;",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS exempt_channel_ids text NOT NULL DEFAULT '';",
      "ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS exempt_role_ids text NOT NULL DEFAULT '';"
    ])
  },
  {
    version: 18,
    name: "verification_quarantine_role",
    sql: q([
      "ALTER TABLE verification_settings ADD COLUMN IF NOT EXISTS quarantine_role_id text;"
    ])
  },
  {
    version: 19,
    name: "music_bot_assignments",
    sql: q([
      "CREATE TABLE IF NOT EXISTS guild_music_bot_assignments (",
      "  guild_id text NOT NULL,",
      "  bot_identity_id text NOT NULL REFERENCES bot_identities(id) ON DELETE CASCADE,",
      "  voice_channel_id text NOT NULL,",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,bot_identity_id),",
      "  UNIQUE(guild_id,voice_channel_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_guild_music_bot_assignments_guild ON guild_music_bot_assignments(guild_id);"
    ])
  },
  {
    version: 20,
    name: "music_autoplay",
    sql: q([
      "ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS autoplay boolean NOT NULL DEFAULT false;"
    ])
  },
  {
    version: 21,
    name: "notification_feed_processing_lease",
    sql: q([
      "ALTER TABLE notification_feeds ADD COLUMN IF NOT EXISTS processing_until timestamptz;",
      "CREATE INDEX IF NOT EXISTS idx_notification_feeds_processing ON notification_feeds(enabled,processing_until,last_polled_at);"
    ])
  },
  {
    version: 22,
    name: "ticket_closing_recovery",
    sql: q([
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closing_at timestamptz;",
      "CREATE INDEX IF NOT EXISTS idx_tickets_closing ON tickets(status,closing_at);"
    ])
  },
  {
    version: 23,
    name: "giveaway_state_recovery",
    sql: q([
      "ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();",
      "CREATE INDEX IF NOT EXISTS idx_giveaways_state_updated ON giveaways(status,updated_at);"
    ])
  },
  {
    version: 24,
    name: "automation_any_conditions",
    sql: q([
      "ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS any_conditions jsonb NOT NULL DEFAULT '[]'::jsonb;"
    ])
  },
  {
    version: 25,
    name: "command_prefix_and_custom_commands",
    sql: q([
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS command_prefix text NOT NULL DEFAULT '!' CHECK(char_length(command_prefix) BETWEEN 1 AND 5);",
      "CREATE TABLE IF NOT EXISTS custom_commands (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  name text NOT NULL,",
      "  aliases text[] NOT NULL DEFAULT '{}',",
      "  description text NOT NULL DEFAULT '',",
      "  enabled boolean NOT NULL DEFAULT true,",
      "  prefix_enabled boolean NOT NULL DEFAULT true,",
      "  slash_enabled boolean NOT NULL DEFAULT false,",
      "  action_type text NOT NULL DEFAULT 'response' CHECK(action_type IN ('response','alias')),",
      "  response text NOT NULL DEFAULT '',",
      "  alias_target text,",
      "  allowed_role_ids text NOT NULL DEFAULT '',",
      "  allowed_channel_ids text NOT NULL DEFAULT '',",
      "  cooldown_seconds integer NOT NULL DEFAULT 0 CHECK(cooldown_seconds BETWEEN 0 AND 86400),",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  UNIQUE(guild_id,name)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_custom_commands_guild_enabled ON custom_commands(guild_id,enabled);"
    ])
  },
  {
    version: 26,
    name: "leveling_voice_and_moderation_resolution",
    sql: q([
      "ALTER TABLE leveling_settings ADD COLUMN IF NOT EXISTS voice_enabled boolean NOT NULL DEFAULT true;",
      "ALTER TABLE leveling_settings ADD COLUMN IF NOT EXISTS voice_xp_per_minute integer NOT NULL DEFAULT 5 CHECK(voice_xp_per_minute BETWEEN 0 AND 1000);",
      "ALTER TABLE leveling_settings ADD COLUMN IF NOT EXISTS voice_ignore_afk boolean NOT NULL DEFAULT true;",
      "ALTER TABLE leveling_settings ADD COLUMN IF NOT EXISTS voice_min_members integer NOT NULL DEFAULT 1 CHECK(voice_min_members BETWEEN 1 AND 99);",
      "ALTER TABLE leveling_users ADD COLUMN IF NOT EXISTS text_xp bigint NOT NULL DEFAULT 0 CHECK(text_xp >= 0);",
      "ALTER TABLE leveling_users ADD COLUMN IF NOT EXISTS voice_xp bigint NOT NULL DEFAULT 0 CHECK(voice_xp >= 0);",
      "UPDATE leveling_users SET text_xp=xp WHERE text_xp=0 AND xp>0;",
      "ALTER TABLE moderation_cases ADD COLUMN IF NOT EXISTS resolved_at timestamptz;"
    ])
  },
  {
    version: 27,
    name: "custom_command_discord_ids",
    sql: q([
      "ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS discord_command_id text;"
    ])
  },
  {
    version: 28,
    name: "leveling_rewards_exclusions",
    sql: q([
      "ALTER TABLE leveling_settings ADD COLUMN IF NOT EXISTS daily_xp_cap bigint NOT NULL DEFAULT 0 CHECK(daily_xp_cap BETWEEN 0 AND 1000000);",
      "CREATE TABLE IF NOT EXISTS leveling_rewards (",
      "  guild_id text NOT NULL,",
      "  level integer NOT NULL CHECK(level > 0),",
      "  role_id text NOT NULL,",
      "  remove_previous boolean NOT NULL DEFAULT true,",
      "  dm_user boolean NOT NULL DEFAULT false,",
      "  message text NOT NULL DEFAULT '',",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,level),",
      "  UNIQUE(guild_id,role_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_leveling_rewards_guild ON leveling_rewards(guild_id,level);",
      "CREATE TABLE IF NOT EXISTS leveling_exclusions (",
      "  guild_id text NOT NULL,",
      "  kind text NOT NULL CHECK(kind IN ('role','channel')),",
      "  ref_id text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,kind,ref_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_leveling_exclusions_guild ON leveling_exclusions(guild_id,kind);",
      "CREATE TABLE IF NOT EXISTS leveling_daily_xp (",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  day date NOT NULL,",
      "  xp bigint NOT NULL DEFAULT 0 CHECK(xp >= 0),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,user_id,day)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_leveling_daily_xp_day ON leveling_daily_xp(day,guild_id);"
    ])
  },
  {
    version: 29,
    name: "command_policies",
    sql: q([
      "CREATE TABLE IF NOT EXISTS command_policies (",
      "  guild_id text NOT NULL,",
      "  command_name text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT true,",
      "  prefix_enabled boolean NOT NULL DEFAULT true,",
      "  slash_enabled boolean NOT NULL DEFAULT true,",
      "  cooldown_seconds integer NOT NULL DEFAULT 0 CHECK(cooldown_seconds BETWEEN 0 AND 86400),",
      "  allowed_role_ids text[] NOT NULL DEFAULT '{}',",
      "  denied_role_ids text[] NOT NULL DEFAULT '{}',",
      "  allowed_channel_ids text[] NOT NULL DEFAULT '{}',",
      "  denied_channel_ids text[] NOT NULL DEFAULT '{}',",
      "  help_visible boolean NOT NULL DEFAULT true,",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,command_name)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_command_policies_guild_enabled ON command_policies(guild_id,enabled);"
    ])
  },
  {
    version: 30,
    name: "custom_command_action_types",
    sql: q([
      "ALTER TABLE custom_commands DROP CONSTRAINT IF EXISTS custom_commands_action_type_check;",
      "ALTER TABLE custom_commands ADD CONSTRAINT custom_commands_action_type_check CHECK(action_type IN ('response','alias','add_role','remove_role','toggle_role'));"
    ])
  },
  {
    version: 31,
    name: "custom_command_role_action",
    sql: q([
      "ALTER TABLE custom_commands ADD COLUMN IF NOT EXISTS role_id text;"
    ])
  },
  {
    version: 32,
    name: "moderation_channel_locks",
    sql: q([
      "CREATE TABLE IF NOT EXISTS moderation_channel_locks (",
      "  guild_id text NOT NULL,",
      "  channel_id text NOT NULL,",
      "  previous_send_messages boolean,",
      "  locked_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,channel_id)",
      ");"
    ])
  },
  {
    version: 33,
    name: "automod_rule_builder",
    sql: q([
      "CREATE TABLE IF NOT EXISTS automod_rules (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  detector text NOT NULL,",
      "  enabled boolean NOT NULL DEFAULT true,",
      "  threshold numeric,",
      "  window_seconds integer,",
      "  action text NOT NULL DEFAULT 'delete' CHECK(action IN ('delete','timeout','warn','log')),",
      "  timeout_minutes integer NOT NULL DEFAULT 0 CHECK(timeout_minutes BETWEEN 0 AND 40320),",
      "  affected_role_ids text[] NOT NULL DEFAULT '{}',",
      "  ignored_role_ids text[] NOT NULL DEFAULT '{}',",
      "  affected_channel_ids text[] NOT NULL DEFAULT '{}',",
      "  ignored_channel_ids text[] NOT NULL DEFAULT '{}',",
      "  ignore_moderators boolean NOT NULL DEFAULT true,",
      "  message_template text NOT NULL DEFAULT '',",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_automod_rules_guild_enabled ON automod_rules(guild_id,enabled);",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_automod_rule_guild_detector ON automod_rules(guild_id,detector);"
    ])
  },
  {
    version: 34,
    name: "guild_general_settings",
    sql: q([
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'ru';",
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';",
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS dj_role_id text;",
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS moderator_role_ids text NOT NULL DEFAULT '';",
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS default_log_channel_id text;"
    ])
  },
  {
    version: 35,
    name: "music_controller_message",
    sql: q([
      "ALTER TABLE music_players ADD COLUMN IF NOT EXISTS controller_message_id text;"
    ])
  },
  {
    version: 36,
    name: "welcome_goodbye_and_role_restore",
    sql: q([
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS goodbye_enabled boolean NOT NULL DEFAULT false;",
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS goodbye_channel_id text;",
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS goodbye_message text NOT NULL DEFAULT '{user} покинул {server}.';",
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS goodbye_embed boolean NOT NULL DEFAULT true;",
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS starter_role_ids text NOT NULL DEFAULT '';",
      "ALTER TABLE welcome_settings ADD COLUMN IF NOT EXISTS restore_roles boolean NOT NULL DEFAULT false;",
      "CREATE TABLE IF NOT EXISTS welcome_role_snapshots (",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  role_ids text[] NOT NULL DEFAULT '{}',",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,user_id)",
      ");"
    ])
  },
  {
    version: 37,
    name: "audit_discord_logging",
    sql: q([
      "ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS audit_log_enabled boolean NOT NULL DEFAULT false;"
    ])
  },
  {
    version: 38,
    name: "music_auto_leave",
    sql: q([
      "ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS auto_leave_seconds integer NOT NULL DEFAULT 30 CHECK(auto_leave_seconds BETWEEN 0 AND 86400);"
    ])
  },
  {
    version: 39,
    name: "stream_alerts",
    sql: q([
      "CREATE TABLE IF NOT EXISTS stream_alerts (",
      "  id bigserial PRIMARY KEY, guild_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('twitch','youtube','vk')),",
      "  target text NOT NULL, target_id text, channel_id text NOT NULL, mention_role_id text,",
      "  enabled boolean NOT NULL DEFAULT true, interval_seconds integer NOT NULL DEFAULT 30 CHECK(interval_seconds BETWEEN 15 AND 3600),",
      "  last_stream_key text, last_online boolean NOT NULL DEFAULT false, last_checked_at timestamptz,",
      "  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_alert_guild_target ON stream_alerts(guild_id,platform,target,channel_id);",
      "CREATE INDEX IF NOT EXISTS idx_stream_alerts_due ON stream_alerts(enabled,last_checked_at,interval_seconds);"
    ])
  }
,
  {
    version: 40,
    name: "music_request_channel",
    sql: q([
      "ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS request_channel_id text;"
    ])
  },
,
  {
    version: 41,
    name: "role_panel_selection_modes",
    sql: q([
      "ALTER TABLE role_panels ADD COLUMN IF NOT EXISTS selection_mode text NOT NULL DEFAULT 'toggle' CHECK(selection_mode IN ('toggle','exclusive','max'));",
      "ALTER TABLE role_panels ADD COLUMN IF NOT EXISTS max_selections integer NOT NULL DEFAULT 1 CHECK(max_selections BETWEEN 1 AND 5);"
    ])
  },
  {
    version: 42,
    name: "ticket_limits_and_activity",
    sql: q([
      "ALTER TABLE ticket_settings ADD COLUMN IF NOT EXISTS max_open_per_user integer NOT NULL DEFAULT 1 CHECK(max_open_per_user BETWEEN 1 AND 10);",
      "ALTER TABLE ticket_settings ADD COLUMN IF NOT EXISTS auto_close_minutes integer NOT NULL DEFAULT 0 CHECK(auto_close_minutes BETWEEN 0 AND 43200);",
      "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();",
      "DROP INDEX IF EXISTS uq_open_ticket_per_creator;",
      "CREATE INDEX IF NOT EXISTS idx_tickets_open_creator ON tickets(guild_id,creator_id,status);",
      "CREATE INDEX IF NOT EXISTS idx_tickets_auto_close ON tickets(status,last_activity_at);"
    ])
  },
  {
    version: 43,
    name: "moderation_notes_and_timed_timeout_resolution",
    sql: q([
      "CREATE TABLE IF NOT EXISTS moderation_notes (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  target_user_id text NOT NULL,",
      "  moderator_user_id text NOT NULL,",
      "  note text NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now()",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_moderation_notes_guild_target ON moderation_notes(guild_id,target_user_id,created_at DESC);"
    ])
  }
 ,
  {
    version: 44,
    name: "polls",
    sql: q([
      "CREATE TABLE IF NOT EXISTS polls (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  channel_id text NOT NULL,",
      "  message_id text,",
      "  creator_id text NOT NULL,",
      "  question text NOT NULL,",
      "  options jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  votes jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "  multiple boolean NOT NULL DEFAULT false,",
      "  ends_at timestamptz,",
      "  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  closed_at timestamptz",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_polls_guild_status ON polls(guild_id,status);",
      "CREATE INDEX IF NOT EXISTS idx_polls_open_end ON polls(status,ends_at);"
    ])
  } ,
  {
    version: 45,
    name: "suggestions",
    sql: q([
      "CREATE TABLE IF NOT EXISTS suggestions (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  channel_id text NOT NULL,",
      "  message_id text,",
      "  creator_id text NOT NULL,",
      "  content text NOT NULL,",
      "  upvotes jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  downvotes jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','rejected')),",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  review_reason text",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_suggestions_guild_status ON suggestions(guild_id,status);"
    ])
  } ,
  {
    version: 46,
    name: "music_saved_state",
    sql: q([
      "CREATE TABLE IF NOT EXISTS music_favorites (",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  identifier text NOT NULL,",
      "  track jsonb NOT NULL,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  PRIMARY KEY(guild_id,user_id,identifier)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_music_favorites_user ON music_favorites(guild_id,user_id,created_at DESC);",
      "CREATE TABLE IF NOT EXISTS music_playlists (",
      "  id bigserial PRIMARY KEY,",
      "  guild_id text NOT NULL,",
      "  user_id text NOT NULL,",
      "  name text NOT NULL,",
      "  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  updated_at timestamptz NOT NULL DEFAULT now(),",
      "  UNIQUE(guild_id,user_id,name)",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(guild_id,user_id,updated_at DESC);"
    ])
  } ] as const;

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
      if (!migration || applied.has(migration.version)) continue;

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
