import type { Database } from "./database.js";
import { ConfigTransferService } from "./config-transfer.js";

export type ServerConfigPreset = {
  id: number;
  guildId: string;
  name: string;
  moduleCount: number;
  createdAt: string;
  updatedAt: string;
};

type PresetRow = {
  id: number;
  guild_id: string;
  name: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

export class ServerConfigPresetService {
  private readonly transfer: ConfigTransferService;

  constructor(private readonly db: Database) {
    this.transfer = new ConfigTransferService(db);
  }

  async list(guildId: string): Promise<ServerConfigPreset[]> {
    const result = await this.db.query<{
      id: number;
      guild_id: string;
      name: string;
      payload: unknown;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT id,guild_id,name,payload,created_at,updated_at FROM server_config_presets WHERE guild_id=$1 ORDER BY updated_at DESC,name",
      [guildId]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      name: row.name,
      moduleCount: countModules(row.payload),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async save(guildId: string, name: string): Promise<ServerConfigPreset> {
    const normalizedName = normalizePresetName(name);
    const payload = await this.transfer.exportGuild(guildId);

    const result = await this.db.query<{ id: number }>(
      `INSERT INTO server_config_presets(guild_id,name,payload)
       VALUES($1,$2,$3::jsonb)
       ON CONFLICT(guild_id,name) DO UPDATE SET
         payload=EXCLUDED.payload,
         updated_at=now()
       RETURNING id`,
      [guildId, normalizedName, JSON.stringify(payload)]
    );

    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id)) throw new Error("preset_save_failed");

    const current = await this.get(guildId, id);
    if (!current) throw new Error("preset_save_failed");
    return current;
  }

  async apply(guildId: string, presetId: number): Promise<ServerConfigPreset> {
    if (!Number.isSafeInteger(presetId) || presetId < 1) throw new Error("invalid_preset_id");

    const result = await this.db.query<PresetRow>(
      "SELECT id,guild_id,name,payload,created_at,updated_at FROM server_config_presets WHERE guild_id=$1 AND id=$2",
      [guildId, presetId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("preset_not_found");

    await this.transfer.importGuild(guildId, row.payload);
    return {
      id: Number(row.id),
      guildId: row.guild_id,
      name: row.name,
      moduleCount: countModules(row.payload),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async delete(guildId: string, presetId: number): Promise<boolean> {
    if (!Number.isSafeInteger(presetId) || presetId < 1) throw new Error("invalid_preset_id");
    const result = await this.db.query(
      "DELETE FROM server_config_presets WHERE guild_id=$1 AND id=$2",
      [guildId, presetId]
    );
    return result.rowCount === 1;
  }

  private async get(guildId: string, presetId: number): Promise<ServerConfigPreset | null> {
    const result = await this.db.query<PresetRow>(
      "SELECT id,guild_id,name,payload,created_at,updated_at FROM server_config_presets WHERE guild_id=$1 AND id=$2",
      [guildId, presetId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      guildId: row.guild_id,
      name: row.name,
      moduleCount: countModules(row.payload),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function normalizePresetName(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_preset_name");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Error("invalid_preset_name");
  return name;
}

function countModules(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const modules = (value as { modules?: unknown }).modules;
  return Array.isArray(modules) ? modules.length : 0;
}
