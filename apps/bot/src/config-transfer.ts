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
  { table: "ticket_settings", fields: ["enabled","category_id","staff_role_id","transcript_channel_id","max_open_per_user","auto_close_minutes"] },
  { table: "ticket_sla_settings", fields: ["enabled","first_response_minutes","reminder_minutes","escalation_minutes","escalation_role_id"] },
  { table: "security_settings", fields: [
    "enabled","max_joins","window_seconds","max_destructive_actions",
    "destructive_window_seconds","quarantine_role_id","log_channel_id",
    "raid_quarantine_enabled","destructive_role_removal","destructive_quarantine_enabled"
  ] },
  { table: "verification_settings", fields: ["enabled","channel_id","verified_role_id","quarantine_role_id","log_channel_id","code_ttl_minutes"] },
  { table: "leveling_settings", fields: ["enabled","xp_per_message","cooldown_seconds","announce_level_up"] },
  { table: "starboard_settings", fields: ["channel_id","threshold","ignore_self_reaction","ignore_bots"] },
  { table: "music_settings", fields: ["enabled","preferred_text_channel_id","request_channel_id","default_volume","announce_track_start","autoplay","twenty_four_seven","queue_access"] },
  { table: "birthday_settings", fields: ["channel_id","announcement_template"] },
  { table: "analytics_settings", fields: ["retention_days","visible_counters"] },
];

const JSON_TABLES: Array<{ table: string; fields: string[] }> = [
  { table: "automation_rules", fields: ["name","enabled","event","conditions","any_conditions","actions","cooldown_seconds"] },
  { table: "automation_workflow_presets", fields: ["name","event","conditions","any_conditions","actions","cooldown_seconds"] },
  { table: "help_pages", fields: ["slug","title","content","enabled"] },
  { table: "role_panels", fields: ["channel_id","message_id","title","roles","selection_mode","max_selections","duration_minutes"] },
  { table: "stream_alerts", fields: ["platform","target","channel_id","mention_role_id","enabled","interval_seconds","message_template"] },
  { table: "tickets", fields: ["channel_id","creator_id","claimed_by","status","priority","tags","created_at","closed_at","last_activity_at"] },
  { table: "notification_feeds", fields: ["channel_id","url","enabled","interval_seconds","last_item_key","last_polled_at","message_template","include_keywords","exclude_keywords"] },
  { table: "role_automation_rules", fields: ["trigger","channel_id","role_id","delay_seconds","enabled"] }
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
        `SELECT ${table.fields.join(",")} FROM ${quoteIdentifier(table.table)} WHERE guild_id=$1 ORDER BY ${table.table === "automation_workflow_presets" ? "updated_at DESC,name" : table.table === "help_pages" ? "updated_at DESC,slug" : "id"}`,
        [guildId]
      );
      const moduleKey =
        table.table === "automation_rules" || table.table === "automation_workflow_presets" ? "automation" :
        table.table === "role_panels" || table.table === "role_automation_rules" ? "roles" :
        table.table === "notification_feeds" ? "notifications" :
        table.table === "tickets" ? "tickets" :
        table.table === "help_pages" ? "automation" :
        "stream-alerts";
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

      const automationPresets = automation?.settings.automation_workflow_presets;
      if (automationPresets !== undefined && !Array.isArray(automationPresets)) {
        throw new Error("invalid_automation_workflow_presets");
      }

      if (Array.isArray(automationPresets)) {
        const normalizedPresets = automationPresets.map((preset) => normalizeImportedAutomationPreset(preset));

        await client.query("DELETE FROM automation_workflow_presets WHERE guild_id=$1", [targetGuildId]);
        for (const preset of normalizedPresets) {
          await client.query(
            "INSERT INTO automation_workflow_presets(guild_id,name,event,conditions,any_conditions,actions,cooldown_seconds) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)",
            [
              targetGuildId,
              preset.name,
              preset.event,
              JSON.stringify(preset.conditions),
              JSON.stringify(preset.anyConditions),
              JSON.stringify(preset.actions),
              preset.cooldownSeconds
            ]
          );
        }
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

      const ticketsModule = data.modules.find((module) => module.key === "tickets");
      const exportedTickets = ticketsModule?.settings.tickets;
      if (exportedTickets !== undefined && !Array.isArray(exportedTickets)) {
        throw new Error("invalid_tickets");
      }
      if (Array.isArray(exportedTickets)) {
        const normalizedTickets = exportedTickets.map((ticket) => normalizeImportedTicket(ticket));
        await client.query("DELETE FROM tickets WHERE guild_id=$1", [targetGuildId]);
        for (const ticket of normalizedTickets) {
          await client.query(
            "INSERT INTO tickets(guild_id,channel_id,creator_id,claimed_by,status,priority,tags,created_at,closed_at,last_activity_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              targetGuildId,
              ticket.channelId,
              ticket.creatorId,
              ticket.claimedBy,
              ticket.status,
              ticket.priority,
              ticket.tags,
              ticket.createdAt,
              ticket.closedAt,
              ticket.lastActivityAt
            ]
          );
        }
      }

      const notificationsModule = data.modules.find((module) => module.key === "notifications");
      const notificationFeeds = notificationsModule?.settings.notification_feeds;
      if (notificationFeeds !== undefined && !Array.isArray(notificationFeeds)) {
        throw new Error("invalid_notification_feeds");
      }
      if (Array.isArray(notificationFeeds)) {
        const normalizedFeeds = notificationFeeds.map((feed) => normalizeImportedNotificationFeed(feed));
        await client.query("DELETE FROM notification_feeds WHERE guild_id=$1", [targetGuildId]);
        for (const feed of normalizedFeeds) {
          await client.query(
            "INSERT INTO notification_feeds(guild_id,channel_id,url,enabled,interval_seconds,last_item_key,last_polled_at,message_template,include_keywords,exclude_keywords) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              targetGuildId,
              feed.channelId,
              feed.url,
              feed.enabled,
              feed.intervalSeconds,
              feed.lastItemKey,
              feed.lastPolledAt,
              feed.messageTemplate,
              feed.includeKeywords,
              feed.excludeKeywords
            ]
          );
        }
      }

      const rolesAutomationModule = data.modules.find((module) => module.key === "roles");
      const roleAutomationRules = rolesAutomationModule?.settings.role_automation_rules;
      if (roleAutomationRules !== undefined && !Array.isArray(roleAutomationRules)) {
        throw new Error("invalid_role_automation_rules");
      }
      if (Array.isArray(roleAutomationRules)) {
        const normalizedRoleRules = roleAutomationRules.map((rule) => normalizeImportedRoleAutomationRule(rule));
        await client.query("DELETE FROM role_automation_rules WHERE guild_id=$1",[targetGuildId]);
        for (const rule of normalizedRoleRules) {
          await client.query(
            "INSERT INTO role_automation_rules(guild_id,trigger,channel_id,role_id,delay_seconds,enabled) VALUES($1,$2,$3,$4,$5,$6)",
            [targetGuildId,rule.trigger,rule.channelId,rule.roleId,rule.delaySeconds,rule.enabled]
          );
        }
      }

      const helpModule = data.modules.find((module) => module.key === "automation");
      const helpPages = helpModule?.settings.help_pages;
      if (helpPages !== undefined && !Array.isArray(helpPages)) {
        throw new Error("invalid_help_pages");
      }
      if (Array.isArray(helpPages)) {
        const normalizedPages = helpPages.map((page) => normalizeImportedHelpPage(page));
        await client.query("DELETE FROM help_pages WHERE guild_id=$1", [targetGuildId]);
        for (const page of normalizedPages) {
          await client.query(
            "INSERT INTO help_pages(guild_id,slug,title,content,enabled) VALUES($1,$2,$3,$4,$5)",
            [targetGuildId,page.slug,page.title,page.content,page.enabled]
          );
        }
      }

      const streamModule = data.modules.find((module) => module.key === "stream-alerts");
      const streamAlerts = streamModule?.settings.stream_alerts;
      if (streamAlerts !== undefined && !Array.isArray(streamAlerts)) {
        throw new Error("invalid_stream_alerts");
      }
      if (Array.isArray(streamAlerts)) {
        const normalizedAlerts = streamAlerts.map((alert) => normalizeImportedStreamAlert(alert));
        await client.query("DELETE FROM stream_alerts WHERE guild_id=$1", [targetGuildId]);
        for (const alert of normalizedAlerts) {
          await client.query(
            "INSERT INTO stream_alerts(guild_id,platform,target,channel_id,mention_role_id,enabled,interval_seconds,message_template) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              targetGuildId,
              alert.platform,
              alert.target,
              alert.channelId,
              alert.mentionRoleId,
              alert.enabled,
              alert.intervalSeconds,
              alert.messageTemplate
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
            "INSERT INTO role_panels(guild_id,channel_id,message_id,title,roles,selection_mode,max_selections,duration_minutes) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)",
            [
              targetGuildId,
              panel.channelId,
              panel.messageId,
              panel.title,
              JSON.stringify(panel.roles),
              panel.selectionMode,
              panel.maxSelections,
              panel.durationMinutes
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

      const values = fields.map((field) => {
        const value = settings[field] ?? defaults[field];
        if ((table === "analytics_settings" && field === "visible_counters") ||
            (table === "starboard_settings" && (field === "ignored_channel_ids" || field === "ignored_role_ids"))) {
          return JSON.stringify(value ?? []);
        }
        return value;
      });
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

    await execute("ticket_sla_settings", "tickets", [
      "enabled","first_response_minutes","reminder_minutes","escalation_minutes","escalation_role_id"
    ], {
      enabled: false,
      first_response_minutes: 30,
      reminder_minutes: 120,
      escalation_minutes: 240,
      escalation_role_id: null
    });

    await execute("ticket_settings", "tickets", [
      "enabled","category_id","staff_role_id","transcript_channel_id","max_open_per_user","auto_close_minutes"
    ], {
      enabled: false,
      category_id: null,
      staff_role_id: null,
      transcript_channel_id: null,
      max_open_per_user: 1,
      auto_close_minutes: 0
    });

    await execute("security_settings", "security", [
      "enabled","max_joins","window_seconds","max_destructive_actions",
      "destructive_window_seconds","quarantine_role_id","log_channel_id",
      "raid_quarantine_enabled","destructive_role_removal","destructive_quarantine_enabled"
    ], {
      enabled: false,
      max_joins: 10,
      window_seconds: 20,
      max_destructive_actions: 5,
      destructive_window_seconds: 20,
      quarantine_role_id: null,
      log_channel_id: null,
      raid_quarantine_enabled: true,
      destructive_role_removal: true,
      destructive_quarantine_enabled: true
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
      "enabled","preferred_text_channel_id","request_channel_id","default_volume","announce_track_start","autoplay","twenty_four_seven","queue_access"
    ], {
      enabled: false,
      preferred_text_channel_id: null,
      request_channel_id: null,
      default_volume: 100,
      announce_track_start: true,
      autoplay: false,
      twenty_four_seven: false,
      queue_access: "everyone"
    });

    await execute("birthday_settings", "birthdays", [
      "channel_id","announcement_template"
    ], {
      channel_id: null,
      announcement_template: "🎂 С днём рождения, {user}!"
    });

    await execute("analytics_settings", "analytics", [
      "retention_days","visible_counters"
    ], {
      retention_days: 30,
      visible_counters: ["message","member_join","member_leave","voice_join","voice_leave","voice_move"]
    });
  }
}

function tableToModule(table: string): ServerModuleConfig["key"] | null {
  switch (table) {
    case "guild_settings": return "temporary-voice";
    case "automod_settings": return "automod";
    case "welcome_settings": return "welcome";
    case "ticket_settings": return "tickets";
    case "ticket_sla_settings": return "tickets";
    case "analytics_settings": return "analytics";
    case "security_settings": return "security";
    case "verification_settings": return "verification";
    case "leveling_settings": return "leveling";
    case "starboard_settings": return "starboard";
    case "music_settings": return "music";
    case "birthday_settings": return "birthdays";
    case "analytics_settings": return "analytics";
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


type NormalizedHelpPage = {
  slug: string;
  title: string;
  content: string;
  enabled: boolean;
};

type NormalizedAutomationPreset = {
  name: string;
  event: AutomationEvent;
  conditions: AutomationCondition[];
  anyConditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldownSeconds: number;
};
type NormalizedAutomationRule = {
  name: string;
  enabled: boolean;
  event: AutomationEvent;
  conditions: AutomationCondition[];
  anyConditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldownSeconds: number;
};

function normalizeImportedHelpPage(value: unknown): NormalizedHelpPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_help_page");
  }
  const object = value as Record<string, unknown>;
  if (
    typeof object.slug !== "string" ||
    !/^[a-z0-9_-]{1,40}$/.test(object.slug) ||
    typeof object.title !== "string" ||
    !object.title.trim() ||
    object.title.length > 100 ||
    typeof object.content !== "string" ||
    !object.content.trim() ||
    object.content.length > 3900 ||
    typeof object.enabled !== "boolean"
  ) {
    throw new Error("invalid_help_page");
  }
  return {
    slug: object.slug.toLowerCase(),
    title: object.title.trim(),
    content: object.content.trim(),
    enabled: object.enabled
  };
}

function normalizeImportedAutomationPreset(value: unknown): NormalizedAutomationPreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_automation_workflow_preset");
  }

  const object = value as Record<string, unknown>;
  if (
    typeof object.name !== "string" ||
    object.name.trim().length === 0 ||
    object.name.length > 40 ||
    typeof object.event !== "string" ||
    !Array.isArray(object.conditions) ||
    !Array.isArray(object.any_conditions) ||
    !Array.isArray(object.actions)
  ) {
    throw new Error("invalid_automation_workflow_preset");
  }

  const cooldownSeconds = Number(object.cooldown_seconds ?? 0);
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400) {
    throw new Error("invalid_automation_workflow_preset");
  }

  validateAutomationRule(
    object.event as AutomationEvent,
    [...(object.conditions as AutomationCondition[]), ...(object.any_conditions as AutomationCondition[])],
    object.actions as AutomationAction[]
  );

  const normalizedName = object.name.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(normalizedName)) {
    throw new Error("invalid_automation_workflow_preset_name");
  }

  return {
    name: normalizedName,
    event: object.event as AutomationEvent,
    conditions: object.conditions as AutomationCondition[],
    anyConditions: object.any_conditions as AutomationCondition[],
    actions: object.actions as AutomationAction[],
    cooldownSeconds
  };
}
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
  selectionMode: "toggle" | "exclusive" | "max";
  maxSelections: number;
  durationMinutes: number;
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
    object.roles.length > 5 ||
    (object.selection_mode !== undefined && !["toggle","exclusive","max"].includes(String(object.selection_mode))) ||
    (object.max_selections !== undefined && (typeof object.max_selections !== "number" || !Number.isInteger(object.max_selections) || object.max_selections < 1 || object.max_selections > 5)) ||
    (object.duration_minutes !== undefined && (typeof object.duration_minutes !== "number" || !Number.isInteger(object.duration_minutes) || object.duration_minutes < 0 || object.duration_minutes > 43200))
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
    roles,
    selectionMode: (typeof object.selection_mode === "string" && ["toggle","exclusive","max"].includes(object.selection_mode)
      ? object.selection_mode
      : "toggle") as "toggle" | "exclusive" | "max",
    maxSelections: typeof object.max_selections === "number" ? Math.min(Math.max(Math.trunc(object.max_selections),1),5) : 1,
    durationMinutes: typeof object.duration_minutes === "number" ? Math.min(Math.max(Math.trunc(object.duration_minutes),0),43200) : 0
  };
}

type ImportedStreamAlert = {
  platform: "twitch" | "youtube" | "vk" | "kick";
  target: string;
  channelId: string;
  mentionRoleId: string | null;
  enabled: boolean;
  intervalSeconds: number;
  messageTemplate: string;
};

type NormalizedNotificationFeed = {
  channelId: string;
  url: string;
  enabled: boolean;
  intervalSeconds: number;
  lastItemKey: string | null;
  lastPolledAt: string | null;
  messageTemplate: string;
  includeKeywords: string[];
  excludeKeywords: string[];
};

type NormalizedTicket = {
  channelId: string;
  creatorId: string;
  claimedBy: string | null;
  status: "open" | "closed" | "closing";
  priority: "low" | "normal" | "high" | "urgent";
  tags: string[];
  createdAt: string;
  closedAt: string | null;
  lastActivityAt: string | null;
};

function normalizeImportedTicket(value: unknown): NormalizedTicket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_ticket");
  const object = value as Record<string, unknown>;
  if (
    typeof object.channel_id !== "string" || !/^\d{17,20}$/.test(object.channel_id) ||
    typeof object.creator_id !== "string" || !/^\d{17,20}$/.test(object.creator_id) ||
    (object.claimed_by !== null && object.claimed_by !== undefined && (typeof object.claimed_by !== "string" || !/^\d{17,20}$/.test(object.claimed_by))) ||
    typeof object.status !== "string" || !["open","closed","closing"].includes(object.status) ||
    typeof object.priority !== "string" || !["low","normal","high","urgent"].includes(object.priority) ||
    !Array.isArray(object.tags) ||
    typeof object.created_at !== "string"
  ) throw new Error("invalid_ticket");

  const tags = [...new Set(
    object.tags.filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0,10)
      .map((tag) => tag.slice(0,40))
  )];

  return {
    channelId: object.channel_id,
    creatorId: object.creator_id,
    claimedBy: object.claimed_by === null || object.claimed_by === undefined ? null : object.claimed_by,
    status: object.status as NormalizedTicket["status"],
    priority: object.priority as NormalizedTicket["priority"],
    tags,
    createdAt: object.created_at,
    closedAt: typeof object.closed_at === "string" ? object.closed_at : null,
    lastActivityAt: typeof object.last_activity_at === "string" ? object.last_activity_at : null
  };
}

type NormalizedRoleAutomationRule = {
  trigger: "member.join" | "voice.join" | "voice.leave";
  channelId: string;
  roleId: string;
  delaySeconds: number;
  enabled: boolean;
};

function normalizeImportedRoleAutomationRule(value: unknown): NormalizedRoleAutomationRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_role_automation_rule");
  const object = value as Record<string, unknown>;
  if (
    typeof object.trigger !== "string" || !["member.join","voice.join","voice.leave"].includes(object.trigger) ||
    typeof object.channel_id !== "string" || (object.channel_id && !/^\d{17,20}$/.test(object.channel_id)) ||
    typeof object.role_id !== "string" || !/^\d{17,20}$/.test(object.role_id) ||
    typeof object.delay_seconds !== "number" || !Number.isInteger(object.delay_seconds) ||
    object.delay_seconds < 0 || object.delay_seconds > 604800 ||
    typeof object.enabled !== "boolean"
  ) throw new Error("invalid_role_automation_rule");
  if (object.trigger !== "member.join" && !object.channel_id) throw new Error("invalid_role_automation_channel");
  return {
    trigger: object.trigger as NormalizedRoleAutomationRule["trigger"],
    channelId: object.channel_id,
    roleId: object.role_id,
    delaySeconds: object.delay_seconds,
    enabled: object.enabled
  };
}

function normalizeImportedNotificationFeed(value: unknown): NormalizedNotificationFeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_notification_feed");
  const object = value as Record<string, unknown>;
  if (
    typeof object.channel_id !== "string" || !/^\d{17,20}$/.test(object.channel_id) ||
    typeof object.url !== "string" || object.url.length > 2000 ||
    typeof object.enabled !== "boolean" ||
    typeof object.interval_seconds !== "number" || !Number.isInteger(object.interval_seconds) ||
    object.interval_seconds < 60 || object.interval_seconds > 86400 ||
    (object.last_item_key !== null && object.last_item_key !== undefined && typeof object.last_item_key !== "string") ||
    (object.last_polled_at !== null && object.last_polled_at !== undefined && typeof object.last_polled_at !== "string") ||
    typeof object.message_template !== "string" || object.message_template.length > 1800 ||
    !Array.isArray(object.include_keywords) || !Array.isArray(object.exclude_keywords)
  ) throw new Error("invalid_notification_feed");

  const normalize = (items: unknown[]) => [...new Set(
    items.filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLocaleLowerCase())
      .filter(Boolean)
      .slice(0,20)
      .map((item) => item.slice(0,80))
  )];

  return {
    channelId: object.channel_id,
    url: object.url,
    enabled: object.enabled,
    intervalSeconds: object.interval_seconds,
    lastItemKey: object.last_item_key === null || object.last_item_key === undefined ? null : object.last_item_key,
    lastPolledAt: object.last_polled_at === null || object.last_polled_at === undefined ? null : object.last_polled_at,
    messageTemplate: object.message_template.trim().slice(0,1800),
    includeKeywords: normalize(object.include_keywords),
    excludeKeywords: normalize(object.exclude_keywords)
  };
}

function normalizeImportedStreamAlert(value: unknown): ImportedStreamAlert {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_stream_alert");
  const object = value as Record<string, unknown>;
  if (
    !["twitch","youtube","vk","kick"].includes(String(object.platform)) ||
    typeof object.target !== "string" ||
    !object.target.trim() ||
    object.target.length > 200 ||
    typeof object.channel_id !== "string" ||
    !/^\d{17,20}$/.test(object.channel_id) ||
    (object.mention_role_id !== null && object.mention_role_id !== undefined &&
      (typeof object.mention_role_id !== "string" || !/^\d{17,20}$/.test(object.mention_role_id))) ||
    typeof object.enabled !== "boolean" ||
    typeof object.interval_seconds !== "number" ||
    !Number.isInteger(object.interval_seconds) ||
    object.interval_seconds < 15 ||
    object.interval_seconds > 3600 ||
    typeof object.message_template !== "string" ||
    object.message_template.length > 1000
  ) throw new Error("invalid_stream_alert");
  return {
    platform: String(object.platform) as ImportedStreamAlert["platform"],
    target: object.target.trim().slice(0,200),
    channelId: object.channel_id,
    mentionRoleId: typeof object.mention_role_id === "string" ? object.mention_role_id : null,
    enabled: object.enabled,
    intervalSeconds: object.interval_seconds,
    messageTemplate: object.message_template
  };
}
