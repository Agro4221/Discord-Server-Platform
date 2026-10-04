import type { Database } from "./database.js";
import { MODULE_CATALOG } from "./modules/catalog.js";
import { validateAutomationRule } from "./modules/automation-engine.js";
import type { AutomationAction, AutomationCondition, AutomationEvent } from "@dsp/domain";
import type { ServerConfigExport, ServerModuleConfig } from "@dsp/domain";

type ExportTable = {
  table: string;
  fields: string[];
};

const CONFIG_TABLES: ExportTable[] = [
  { table: "guild_settings", fields: [
    "temp_voice_enabled","temp_voice_trigger_channel_id","temp_voice_category_id",
    "temp_voice_default_limit","temp_voice_private"
  ]},
  { table: "guild_modules", fields: ["module_key","enabled"] },
  { table: "automod_settings", fields: [
    "enabled","blocked_words","max_mentions","max_caps_ratio",
    "max_repeated_messages","repeated_window_seconds","block_links","block_invites",
    "max_links","max_emojis","max_line_length","exempt_channel_ids","exempt_role_ids",
    "delete_message","timeout_minutes"
  ]},
  { table: "welcome_settings", fields: ["enabled","channel_id","message","dm","embed"] },
  { table: "ticket_settings", fields: ["enabled","category_id","staff_role_id","transcript_channel_id"] },
  { table: "security_settings", fields: [
    "enabled","max_joins","window_seconds","max_destructive_actions",
    "destructive_window_seconds","quarantine_role_id","log_channel_id",
    "incident_duration_seconds","auto_quarantine","remove_executor_roles","executor_timeout_minutes","executor_ban_enabled"
  ] },
  { table: "verification_settings", fields: ["enabled","channel_id","verified_role_id","quarantine_role_id","log_channel_id","code_ttl_minutes"] },
  { table: "leveling_settings", fields: ["enabled","xp_per_message","cooldown_seconds","announce_level_up"] },
  { table: "starboard_settings", fields: ["channel_id","threshold","ignore_self_reaction","ignore_bots"] },
  { table: "music_settings", fields: ["enabled","preferred_text_channel_id","default_volume","announce_track_start","autoplay"] }
];

const JSON_TABLES: Array<{ table: string; fields: string[] }> = [
  { table: "automation_rules", fields: ["name","enabled","event","conditions","any_conditions","actions","cooldown_seconds"] },
  { table: "role_panels", fields: ["channel_id","message_id","title","roles"] }
];

export class ConfigTransferService {
  constructor(private readonly db: Database) {}

  async exportGuild(guildId: string): Promise<ServerConfigExport> {
    const modulesResult = await this.db.query<{
      module_key: string;
      enabled: boolean;
    }>(
      "SELECT module_key,enabled FROM guild_modules WHERE guild_id=$1 ORDER BY module_key",
      [guildId]
    );

    const moduleKeys = new Set(MODULE_CATALOG.map((module) => module.key));
    const modules: ServerModuleConfig[] = [];

    for (const row of modulesResult.rows) {
      if (!moduleKeys.has(row.module_key as never)) continue;
      modules.push({
        key: row.module_key as ServerModuleConfig["key"],
        enabled: row.enabled,
        settings: {}
      });
    }

    for (const table of CONFIG_TABLES) {
      const result = await this.db.query(
        `SELECT ${table.fields.join(",")} FROM ${quoteIdentifier(table.table)} WHERE guild_id=$1`,
        [guildId]
      );
      if (result.rows[0]) {
        const moduleKey = tableToModule(table.table);
        if (!moduleKey) continue;
        const target = modules.find((module) => module.key === moduleKey);
        if (target) target.settings = sanitizeJson(result.rows[0]);
        else modules.push({
          key: moduleKey,
          enabled: Boolean((result.rows[0] as Record<string, unknown>).enabled ?? false),
          settings: sanitizeJson(result.rows[0])
        });
      }
    }

    for (const table of JSON_TABLES) {
      const result = await this.db.query(
        `SELECT ${table.fields.join(",")} FROM ${quoteIdentifier(table.table)} WHERE guild_id=$1 ORDER BY id`,
        [guildId]
      );
      const moduleKey = table.table === "automation_rules" ? "automation" : "roles";
      const target = modules.find((module) => module.key === moduleKey);
      if (target) {
        target.settings[table.table] = result.rows.map((row) => sanitizeJson(row));
      }
    }

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      guildId,
      modules
    };
  }

  async importGuild(targetGuildId: string, payload: unknown): Promise<void> {
    validateExport(payload);

    const data = payload as ServerConfigExport;
    if (data.guildId !== targetGuildId) {
      throw new Error("cross_guild_import_requires_resource_remapping");
    }

    await this.db.transaction(async (client) => {
      for (const module of data.modules) {
        const moduleKey = module.key;
        const known = MODULE_CATALOG.some((candidate) => candidate.key === moduleKey);
        if (!known) throw new Error(`unknown_module:${moduleKey}`);

        await client.query(
          `INSERT INTO guild_modules(guild_id,module_key,enabled)
           VALUES($1,$2,$3)
           ON CONFLICT(guild_id,module_key)
           DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
          [targetGuildId, moduleKey, module.enabled]
        );
      }

      await this.upsertSettings(client, targetGuildId, data.modules);

      const automation = data.modules.find((module) => module.key === "automation");
      const automationRules = automation?.settings.automation_rules;
      if (automationRules !== undefined && !Array.isArray(automationRules)) {
        throw new Error("invalid_automation_rules");
      }

      if (Array.isArray(automationRules)) {
        const normalizedRules = automationRules.map((rule) => normalizeImportedAutomationRule(rule));

        await client.query("DELETE FROM automation_rules WHERE guild_id=$1", [targetGuildId]);
        for (const rule of normalizedRules) {
          await client.query(
            `INSERT INTO automation_rules(
              guild_id,name,enabled,event,conditions,any_conditions,actions,cooldown_seconds
            ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)`,
            [
              targetGuildId,
              rule.name,
              rule.enabled,
              rule.event,
              JSON.stringify(rule.conditions),
              JSON.stringify(rule.anyConditions),
              JSON.stringify(rule.actions),
              rule.cooldownSeconds
            ]
          );
        }
      }

      const rolesModule = data.modules.find((module) => module.key === "roles");
      const rolePanels = rolesModule?.settings.role_panels;
      if (rolePanels !== undefined && !Array.isArray(rolePanels)) {
        throw new Error("invalid_role_panels");
      }

      if (Array.isArray(rolePanels)) {
        const normalizedPanels = rolePanels.map((panel) => normalizeImportedRolePanel(panel));
        await client.query("DELETE FROM role_panels WHERE guild_id=$1", [targetGuildId]);
        for (const panel of normalizedPanels) {
          await client.query(
            "INSERT INTO role_panels(guild_id,channel_id,message_id,title,roles) VALUES($1,$2,$3,$4,$5::jsonb)",
            [
              targetGuildId,
              panel.channelId,
              panel.messageId,
              panel.title,
              JSON.stringify(panel.roles)
            ]
          );
        }
      }
    });
  }

  private async upsertSettings(
    client: import("pg").PoolClient,
    guildId: string,
    modules: ServerModuleConfig[]
  ): Promise<void> {
    const byKey = new Map(modules.map((module) => [module.key, module.settings]));

    const execute = async (
      table: string,
      moduleKey: ServerModuleConfig["key"],
      fields: string[],
      defaults: Record<string, unknown>
    ) => {
      const settings = byKey.get(moduleKey);
      if (!settings) return;

      const values = fields.map((field) => settings[field] ?? defaults[field]);
      const columns = ["guild_id", ...fields];
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const updates = fields.map((field) => `${field}=EXCLUDED.${field}`);

      await client.query(
        `INSERT INTO ${quoteIdentifier(table)}(${columns.map(quoteIdentifier).join(",")})
         VALUES(${placeholders.join(",")})
         ON CONFLICT(guild_id) DO UPDATE SET ${updates.join(",")},updated_at=now()`,
        [guildId, ...values]
      );
    };

    await execute("guild_settings", "temporary-voice", [
      "temp_voice_enabled","temp_voice_trigger_channel_id","temp_voice_category_id",
      "temp_voice_default_limit","temp_voice_private"
    ], {
      temp_voice_enabled: false,
      temp_voice_trigger_channel_id: null,
      temp_voice_category_id: null,
      temp_voice_default_limit: 0,
      temp_voice_private: false
    });

    await execute("automod_settings", "automod", [
      "enabled","blocked_words","max_mentions","max_caps_ratio",
      "max_repeated_messages","repeated_window_seconds","block_links","block_invites",
      "max_links","max_emojis","max_line_length","exempt_channel_ids","exempt_role_ids",
      "delete_message","timeout_minutes"
    ], {
      enabled: false,
      blocked_words: [],
      max_mentions: 6,
      max_caps_ratio: 0.85,
      max_repeated_messages: 5,
      repeated_window_seconds: 10,
      block_links: false,
      block_invites: false,
      max_links: 3,
      max_emojis: 20,
      max_line_length: 1000,
      exempt_channel_ids: "",
      exempt_role_ids: "",
      delete_message: true,
      timeout_minutes: 0
    });

    await execute("welcome_settings", "welcome", [
      "enabled","channel_id","message","dm","embed"
    ], {
      enabled: false,
      channel_id: null,
      message: "Добро пожаловать, {mention}, на {server}!",
      dm: false,
      embed: true
    });

    await execute("ticket_settings", "tickets", [
      "enabled","category_id","staff_role_id","transcript_channel_id"
    ], {
      enabled: false,
      category_id: null,
      staff_role_id: null,
      transcript_channel_id: null
    });

    await execute("security_settings", "security", [
      "enabled","max_joins","window_seconds","max_destructive_actions",
      "destructive_window_seconds","quarantine_role_id","log_channel_id","incident_duration_seconds",
      "auto_quarantine","remove_executor_roles","executor_timeout_minutes"
    ], {
      enabled: false,
      max_joins: 10,
      window_seconds: 20,
      max_destructive_actions: 5,
      destructive_window_seconds: 20,
      quarantine_role_id: null,
      log_channel_id: null,
      incident_duration_seconds: 300,
      auto_quarantine: true,
      remove_executor_roles: true,
      executor_timeout_minutes: 0
    });

    await execute("verification_settings", "verification", [
      "enabled","channel_id","verified_role_id","quarantine_role_id","log_channel_id","code_ttl_minutes"
    ], {
      enabled: false,
      channel_id: null,
      verified_role_id: null,
      quarantine_role_id: null,
      log_channel_id: null,
      code_ttl_minutes: 10
    });

    await execute("leveling_settings", "leveling", [
      "enabled","xp_per_message","cooldown_seconds","announce_level_up"
    ], {
      enabled: false,
      xp_per_message: 10,
      cooldown_seconds: 30,
      announce_level_up: true
    });

    await execute("starboard_settings", "starboard", [
      "channel_id","threshold","ignore_self_reaction","ignore_bots"
    ], {
      channel_id: "",
      threshold: 3,
      ignore_self_reaction: true,
      ignore_bots: true
    });

    await execute("music_settings", "music", [
      "enabled","preferred_text_channel_id","default_volume","announce_track_start","autoplay"
    ], {
      enabled: false,
      preferred_text_channel_id: null,
      default_volume: 100,
      announce_track_start: true,
      autoplay: false
    });
  }
}

function tableToModule(table: string): ServerModuleConfig["key"] | null {
  switch (table) {
    case "guild_settings": return "temporary-voice";
    case "automod_settings": return "automod";
    case "welcome_settings": return "welcome";
    case "ticket_settings": return "tickets";
    case "security_settings": return "security";
    case "verification_settings": return "verification";
    case "leveling_settings": return "leveling";
    case "starboard_settings": return "starboard";
    case "music_settings": return "music";
    default: return null;
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error("unsafe_identifier");
  }
  return `"${identifier}"`;
}

function sanitizeJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function validateExport(payload: unknown): asserts payload is ServerConfigExport {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_export");
  }

  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("unsupported_schema_version");
  if (typeof record.guildId !== "string" || !/^\d{17,20}$/.test(record.guildId)) {
    throw new Error("invalid_guild_id");
  }

  if (!Array.isArray(record.modules) || record.modules.length > MODULE_CATALOG.length) {
    throw new Error("invalid_modules");
  }

  const seenModules = new Set<string>();

  for (const module of record.modules) {
    if (!module || typeof module !== "object") throw new Error("invalid_module");
    const item = module as Record<string, unknown>;
    if (typeof item.key !== "string" || !MODULE_CATALOG.some((known) => known.key === item.key)) {
      throw new Error("unknown_module");
    }
    if (seenModules.has(item.key)) throw new Error("duplicate_module");
    seenModules.add(item.key);
    if (typeof item.enabled !== "boolean") throw new Error("invalid_module_enabled");
    if (!item.settings || typeof item.settings !== "object" || Array.isArray(item.settings)) {
      throw new Error("invalid_module_settings");
    }
  }
}


type NormalizedAutomationRule = {
  name: string;
  enabled: boolean;
  event: AutomationEvent;
  conditions: AutomationCondition[];
  anyConditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldownSeconds: number;
};

function normalizeImportedAutomationRule(value: unknown): NormalizedAutomationRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_automation_rule");
  }

  const object = value as Record<string, unknown>;
  if (
    typeof object.name !== "string" ||
    !object.name.trim() ||
    object.name.length > 80 ||
    typeof object.enabled !== "boolean" ||
    typeof object.event !== "string" ||
    !Array.isArray(object.conditions) ||
    (object.any_conditions !== undefined && !Array.isArray(object.any_conditions)) ||
    !Array.isArray(object.actions) ||
    typeof object.cooldown_seconds !== "number" ||
    !Number.isInteger(object.cooldown_seconds) ||
    object.cooldown_seconds < 0 ||
    object.cooldown_seconds > 86400
  ) {
    throw new Error("invalid_automation_rule");
  }

  validateAutomationRule(
    object.event as AutomationEvent,
    [
      ...(object.conditions as AutomationCondition[]),
      ...((object.any_conditions as AutomationCondition[] | undefined) ?? [])
    ],
    object.actions as AutomationAction[]
  );

  return {
    name: object.name.trim(),
    enabled: object.enabled,
    event: object.event as AutomationEvent,
    conditions: object.conditions as AutomationCondition[],
    anyConditions: (object.any_conditions as AutomationCondition[] | undefined) ?? [],
    actions: object.actions as AutomationAction[],
    cooldownSeconds: object.cooldown_seconds
  };
}


type ImportedRolePanel = {
  channelId: string;
  messageId: string | null;
  title: string;
  roles: Array<{ roleId: string; label: string }>;
};

function normalizeImportedRolePanel(value: unknown): ImportedRolePanel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_role_panel");
  }

  const object = value as Record<string, unknown>;
  if (
    typeof object.channel_id !== "string" ||
    !/^\d{17,20}$/.test(object.channel_id) ||
    object.message_id !== null && object.message_id !== undefined &&
      (typeof object.message_id !== "string" || !/^\d{17,20}$/.test(object.message_id)) ||
    typeof object.title !== "string" ||
    object.title.length > 100 ||
    !Array.isArray(object.roles) ||
    object.roles.length < 1 ||
    object.roles.length > 5
  ) {
    throw new Error("invalid_role_panel");
  }

  const roles = object.roles.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("invalid_role_panel_role");
    }
    const role = entry as Record<string, unknown>;
    if (
      typeof role.roleId !== "string" ||
      !/^\d{17,20}$/.test(role.roleId) ||
      typeof role.label !== "string" ||
      !role.label.trim() ||
      role.label.length > 80
    ) {
      throw new Error("invalid_role_panel_role");
    }
    return { roleId: role.roleId, label: role.label.trim().slice(0, 80) };
  });

  return {
    channelId: object.channel_id,
    messageId: typeof object.message_id === "string" ? object.message_id : null,
    title: object.title.trim().slice(0, 100) || "Выберите роли",
    roles
  };
}
