import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type TempVoiceSettings = {
  guildId: string;
  triggerChannelId: string;
  categoryId: string | null;
  userLimit: number;
  privateByDefault: boolean;
};

export type StreamSource = {
  id: number;
  provider: "twitch" | "youtube" | "vk";
  identifier: string;
  displayName: string;
  discordChannelId: string;
  template: string;
  enabled: boolean;
  lastLiveId: string | null;
};

export class Store {
  readonly db: Database.Database;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS guild_settings (" +
        "guild_id TEXT PRIMARY KEY," +
        "command_channel_id TEXT" +
      ")",
      "CREATE TABLE IF NOT EXISTS temp_voice_settings (" +
        "guild_id TEXT PRIMARY KEY," +
        "trigger_channel_id TEXT NOT NULL," +
        "category_id TEXT," +
        "user_limit INTEGER NOT NULL DEFAULT 0 CHECK(user_limit BETWEEN 0 AND 99)," +
        "private_by_default INTEGER NOT NULL DEFAULT 0 CHECK(private_by_default IN (0,1))" +
      ")",
      "CREATE TABLE IF NOT EXISTS temp_rooms (" +
        "guild_id TEXT NOT NULL," +
        "channel_id TEXT PRIMARY KEY," +
        "owner_id TEXT NOT NULL" +
      ")",
      "CREATE TABLE IF NOT EXISTS stream_sources (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "provider TEXT NOT NULL CHECK(provider IN ('twitch','youtube','vk'))," +
        "identifier TEXT NOT NULL," +
        "display_name TEXT NOT NULL," +
        "discord_channel_id TEXT NOT NULL," +
        "template TEXT NOT NULL," +
        "enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))," +
        "last_live_id TEXT," +
        "UNIQUE(provider, identifier, discord_channel_id)" +
      ")"
    ].join(";"));
  }

  getCommandChannel(guildId: string): string | null {
    const row = this.db.prepare(
      "SELECT command_channel_id FROM guild_settings WHERE guild_id = ?"
    ).get(guildId) as { command_channel_id: string | null } | undefined;

    return row?.command_channel_id ?? null;
  }

  setCommandChannel(guildId: string, channelId: string | null): void {
    this.db.prepare(
      "INSERT INTO guild_settings(guild_id, command_channel_id) VALUES (?, ?) " +
      "ON CONFLICT(guild_id) DO UPDATE SET command_channel_id=excluded.command_channel_id"
    ).run(guildId, channelId);
  }

  getTempVoice(guildId: string): TempVoiceSettings | null {
    const row = this.db.prepare(
      "SELECT guild_id, trigger_channel_id, category_id, user_limit, private_by_default " +
      "FROM temp_voice_settings WHERE guild_id = ?"
    ).get(guildId) as {
      guild_id: string;
      trigger_channel_id: string;
      category_id: string | null;
      user_limit: number;
      private_by_default: number;
    } | undefined;

    if (!row) return null;

    return {
      guildId: row.guild_id,
      triggerChannelId: row.trigger_channel_id,
      categoryId: row.category_id,
      userLimit: row.user_limit,
      privateByDefault: row.private_by_default === 1
    };
  }

  saveTempVoice(settings: TempVoiceSettings): void {
    this.db.prepare(
      "INSERT INTO temp_voice_settings " +
      "(guild_id, trigger_channel_id, category_id, user_limit, private_by_default) " +
      "VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(guild_id) DO UPDATE SET " +
      "trigger_channel_id=excluded.trigger_channel_id, " +
      "category_id=excluded.category_id, " +
      "user_limit=excluded.user_limit, " +
      "private_by_default=excluded.private_by_default"
    ).run(
      settings.guildId,
      settings.triggerChannelId,
      settings.categoryId,
      settings.userLimit,
      settings.privateByDefault ? 1 : 0
    );
  }

  listTempRooms(): Array<{ guildId: string; channelId: string; ownerId: string }> {
    const rows = this.db.prepare(
      "SELECT guild_id, channel_id, owner_id FROM temp_rooms"
    ).all() as Array<{ guild_id: string; channel_id: string; owner_id: string }>;

    return rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      ownerId: row.owner_id
    }));
  }

  addTempRoom(guildId: string, channelId: string, ownerId: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO temp_rooms(guild_id, channel_id, owner_id) VALUES (?, ?, ?)"
    ).run(guildId, channelId, ownerId);
  }

  removeTempRoom(channelId: string): void {
    this.db.prepare("DELETE FROM temp_rooms WHERE channel_id = ?").run(channelId);
  }

  isTempRoom(channelId: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM temp_rooms WHERE channel_id = ?").get(channelId)
    );
  }

  listStreamSources(): StreamSource[] {
    const rows = this.db.prepare(
      "SELECT id, provider, identifier, display_name, discord_channel_id, " +
      "template, enabled, last_live_id FROM stream_sources ORDER BY id DESC"
    ).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      provider: row.provider as StreamSource["provider"],
      identifier: String(row.identifier),
      displayName: String(row.display_name),
      discordChannelId: String(row.discord_channel_id),
      template: String(row.template),
      enabled: Number(row.enabled) === 1,
      lastLiveId: row.last_live_id ? String(row.last_live_id) : null
    }));
  }

  updateStreamSource(
    id: number,
    input: Omit<StreamSource, "id" | "enabled" | "lastLiveId">
  ): void {
    this.db.prepare(
      "UPDATE stream_sources SET provider = ?, identifier = ?, display_name = ?, " +
      "discord_channel_id = ?, template = ? WHERE id = ?"
    ).run(
      input.provider,
      input.identifier,
      input.displayName,
      input.discordChannelId,
      input.template,
      id
    );
  }

  addStreamSource(
    input: Omit<StreamSource, "id" | "enabled" | "lastLiveId">
  ): number {
    this.db.prepare(
      "INSERT INTO stream_sources " +
      "(provider, identifier, display_name, discord_channel_id, template, enabled) " +
      "VALUES (?, ?, ?, ?, ?, 1) " +
      "ON CONFLICT(provider, identifier, discord_channel_id) DO UPDATE SET " +
      "display_name=excluded.display_name, template=excluded.template"
    ).run(
      input.provider,
      input.identifier,
      input.displayName,
      input.discordChannelId,
      input.template
    );

    const row = this.db.prepare(
      "SELECT id FROM stream_sources " +
      "WHERE provider = ? AND identifier = ? AND discord_channel_id = ?"
    ).get(
      input.provider,
      input.identifier,
      input.discordChannelId
    ) as { id: number } | undefined;

    if (!row) {
      throw new Error("Источник стрима не удалось сохранить в SQLite.");
    }

    return row.id;
  }

  setStreamEnabled(id: number, enabled: boolean): void {
    this.db.prepare(
      "UPDATE stream_sources SET enabled = ? WHERE id = ?"
    ).run(enabled ? 1 : 0, id);
  }

  deleteStreamSource(id: number): void {
    this.db.prepare("DELETE FROM stream_sources WHERE id = ?").run(id);
  }

  setLastLiveId(id: number, liveId: string): void {
    this.db.prepare(
      "UPDATE stream_sources SET last_live_id = ? WHERE id = ?"
    ).run(liveId, id);
  }
}
