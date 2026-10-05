import type { Database } from "../database.js";
import type { AutoMod, AutoModConfig } from "./automod.js";
import type { Moderation } from "./moderation.js";
import type { Security, SecurityConfig } from "./security.js";

export type ModerationPreset = {
  name: string;
  automod: {
    config: AutoModConfig;
    rules: Array<Awaited<ReturnType<AutoMod["listRules"]>>[number]>;
  };
  security: SecurityConfig;
  escalations: Array<Awaited<ReturnType<Moderation["listEscalations"]>>[number]>;
  updatedAt: string;
};

export class ModerationPresets {
  constructor(
    private readonly db: Database,
    private readonly autoMod: AutoMod,
    private readonly security: Security,
    private readonly moderation: Moderation
  ) {}

  async list(guildId: string): Promise<Array<Omit<ModerationPreset, "automod" | "security" | "escalations"> & {
    automodRuleCount: number;
    escalationCount: number;
  }>> {
    const result = await this.db.query<{
      name: string;
      payload: ModerationPreset;
      updated_at: string;
    }>(
      "SELECT name,payload,updated_at FROM moderation_presets WHERE guild_id=$1 ORDER BY updated_at DESC,name",
      [guildId]
    );
    return result.rows.map((row) => ({
      name: row.name,
      automodRuleCount: row.payload?.automod?.rules?.length ?? 0,
      escalationCount: row.payload?.escalations?.length ?? 0,
      updatedAt: row.updated_at
    }));
  }

  async saveCurrent(guildId: string, name: string): Promise<void> {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) throw new Error("invalid_moderation_preset_name");

    const payload: Omit<ModerationPreset, "updatedAt"> = {
      name: normalizedName,
      automod: {
        config: await this.autoMod.getConfig(guildId),
        rules: await this.autoMod.listRules(guildId)
      },
      security: await this.security.getConfig(guildId),
      escalations: await this.moderation.listEscalations(guildId)
    };

    validatePreset(payload);
    await this.db.query(
      "INSERT INTO moderation_presets(guild_id,name,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(guild_id,name) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()",
      [guildId,normalizedName,JSON.stringify(payload)]
    );
  }

  async apply(guildId: string, name: string): Promise<void> {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) throw new Error("invalid_moderation_preset_name");

    const result = await this.db.query<{ payload: ModerationPreset }>(
      "SELECT payload FROM moderation_presets WHERE guild_id=$1 AND name=$2",
      [guildId,normalizedName]
    );
    const payload = result.rows[0]?.payload;
    if (!payload) throw new Error("moderation_preset_not_found");
    validatePreset(payload);

    await this.autoMod.configure(guildId,payload.automod.config);

    const currentRules = await this.autoMod.listRules(guildId);
    for (const rule of currentRules) {
      await this.autoMod.deleteRule(guildId,rule.id);
    }
    for (const rule of payload.automod.rules) {
      await this.autoMod.upsertRule(guildId,{
        detector: rule.detector,
        enabled: rule.enabled,
        threshold: rule.threshold,
        windowSeconds: rule.windowSeconds,
        action: rule.action,
        timeoutMinutes: rule.timeoutMinutes,
        affectedRoleIds: rule.affectedRoleIds,
        ignoredRoleIds: rule.ignoredRoleIds,
        affectedChannelIds: rule.affectedChannelIds,
        ignoredChannelIds: rule.ignoredChannelIds,
        ignoreModerators: rule.ignoreModerators,
        messageTemplate: rule.messageTemplate
      });
    }

    await this.security.configure(guildId,payload.security);

    const currentEscalations = await this.moderation.listEscalations(guildId);
    for (const rule of currentEscalations) {
      await this.moderation.removeEscalation(guildId,rule.warnCount);
    }
    for (const rule of payload.escalations) {
      await this.moderation.setEscalation(
        guildId,
        rule.warnCount,
        rule.action,
        rule.durationMinutes,
        rule.reason,
        rule.enabled
      );
    }
  }

  async delete(guildId: string, name: string): Promise<boolean> {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) throw new Error("invalid_moderation_preset_name");
    const result = await this.db.query(
      "DELETE FROM moderation_presets WHERE guild_id=$1 AND name=$2",
      [guildId,normalizedName]
    );
    return result.rowCount === 1;
  }
}

function normalizePresetName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(name) ? name : "";
}

function validatePreset(payload: ModerationPreset | Omit<ModerationPreset, "updatedAt">): void {
  if (
    !payload ||
    typeof payload !== "object" ||
    !payload.automod ||
    !payload.security ||
    !Array.isArray(payload.automod.rules) ||
    !Array.isArray(payload.escalations)
  ) {
    throw new Error("invalid_moderation_preset");
  }
  if (payload.automod.rules.length > 100 || payload.escalations.length > 100) {
    throw new Error("invalid_moderation_preset_size");
  }
}
