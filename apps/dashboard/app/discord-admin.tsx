"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { AnalyticsPanel } from "./analytics-panel";
import { AutomationPanel } from "./automation-panel";
import { BackupPanel } from "./backup-panel";
import { FleetPanel } from "./fleet-panel";
import { GiveawaysPanel } from "./giveaways-panel";
import { NotificationsPanel } from "./notifications-panel";
import { StreamAlertsPanel } from "./stream-alerts-panel";
import { RolePanelsEditor } from "./role-panels-editor";

type Guild = {
  id: string;
  name: string;
  icon: string | null;
  memberCount?: number;
  channelCount?: number;
  roleCount?: number;
};

type CatalogItem = {
  key: string;
  title: string;
  description: string;
  defaultEnabled?: boolean;
};

type ModuleState = Record<string, boolean>;

type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "channel" | "role" | "textarea";
  description?: string;
  min?: number;
  max?: number;
  step?: number;
};

type Schema = {
  key: string;
  title: string;
  fields: Field[];
  actions?: Array<{ id: string; label: string; kind?: "safe" | "danger"; confirmation?: string }>;
};

type Resource = {
  id: string;
  name: string;
  type?: number;
  manageable?: boolean;
};

type AuditEvent = {
  action: string;
  target_id: string | null;
  created_at: string;
};

type Member = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  manageable: boolean;
  bannable: boolean;
  moderatable: boolean;
};

type MusicState = {
  enabled: boolean;
  initialized: boolean;
  voiceChannelId: string | null;
  paused: boolean;
  volume: number;
  repeatMode: "off" | "track" | "queue";
  autoplay: boolean;
  nodeCount: number;
  current: {
    title: string;
    author: string;
    durationMs: number;
    positionMs: number;
  } | null;
  queue: Array<{ title: string; author: string; durationMs: number }>;
};

type GeneralSettings = {
  commandPrefix: string;
  locale: "ru" | "en" | string;
  timezone: string;
  djRoleId: string | null;
  moderatorRoleIds: string[];
  defaultLogChannelId: string | null;
  auditLogEnabled: boolean;
};

type CustomCommand = {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  actionType: "response" | "alias" | "add_role" | "remove_role" | "toggle_role";
  response: string;
  aliasTarget: string | null;
  allowedRoleIds: string[];
  allowedChannelIds: string[];
  cooldownSeconds: number;
  roleId: string | null;
};

const NAV_GROUPS = [
  {
    label: "Основное",
    items: [
      ["overview", "Обзор", "⌂"],
      ["moderation", "Модерация", "⚖"],
      ["automod", "AutoMod", "⌁"],
      ["security", "Security", "◉"]
    ]
  },
  {
    label: "Сервер",
    items: [
      ["welcome", "Welcome", "✧"],
      ["verification", "Верификация", "✓"],
      ["temporary-voice", "Temporary Voice", "◌"],
      ["roles", "Роли", "♙"],
      ["tickets", "Тикеты", "▤"]
    ]
  },
  {
    label: "Сообщество",
    items: [
      ["leveling", "Leveling", "★"],
      ["giveaways", "Giveaways", "🎁"],
      ["economy", "Economy", "◎"],
      ["starboard", "Starboard", "✦"],
      ["reminders", "Напоминания", "◷"]
    ]
  },
  {
    label: "Инструменты",
    items: [
      ["automation", "Automation", "↯"],
      ["notifications", "Уведомления", "◬"],
      ["stream-alerts", "Стримы", "◉"],
      ["music", "Music", "♫"],
      ["analytics", "Analytics", "▥"],
      ["custom-commands", "Custom Commands", "⌘"]
    ]
  }
] as const;

const SYSTEM_ITEMS = [
  ["settings", "Общие настройки", "⚙"],
  ["commands", "Команды", "⌘"],
  ["fleet", "Bot Fleet", "◈"],
  ["backups", "Резервные копии", "⧉"],
  ["audit", "Журнал действий", "↗"]
] as const;

const PANEL_KEYS = new Set(["roles", "giveaways", "analytics", "automation", "notifications", "stream-alerts"]);

const moduleTitle = (catalog: CatalogItem[], key: string): string =>
  catalog.find((item) => item.key === key)?.title ?? key;

const panelStyle = {
  background: "#11161e",
  border: "1px solid #252d39",
  borderRadius: 14
} as const;

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  color: "#eef2f7",
  border: "1px solid #303946",
  borderRadius: 9,
  padding: "10px 11px",
  outline: "none"
};

export function DiscordAdmin() {
  const [view, setView] = useState("overview");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modules, setModules] = useState<ModuleState>({});
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [resources, setResources] = useState<{ channels: Resource[]; roles: Resource[] }>({ channels: [], roles: [] });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [general, setGeneral] = useState<GeneralSettings>({
    commandPrefix: "!",
    locale: "ru",
    timezone: "UTC",
    djRoleId: null,
    moderatorRoleIds: [],
    defaultLogChannelId: null,
    auditLogEnabled: false
  });

  const selectedGuild = guilds.find((item) => item.id === guildId);
  const selectedSchema = schemas.find((item) => item.key === view) ?? null;
  const filteredGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return NAV_GROUPS;
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item[0] === "overview" || item[1].toLocaleLowerCase().includes(query))
    })).filter((group) => group.items.length);
  }, [search]);

  async function getJson(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(path, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "request_failed"));
    return body as Record<string, unknown>;
  }

  async function loadGuild(guild: string) {
    setLoading(true);
    setError("");
    try {
      const [moduleResponse, resourceResponse, auditResponse] = await Promise.all([
        getJson("/api/guilds/" + encodeURIComponent(guild) + "/modules"),
        getJson("/api/guilds/" + encodeURIComponent(guild) + "/resources"),
        getJson("/api/guilds/" + encodeURIComponent(guild) + "/audit?limit=30")
      ]);
      const list = (moduleResponse.modules ?? []) as Array<{ module_key: string; enabled: boolean }>;
      setCatalog((moduleResponse.catalog ?? []) as CatalogItem[]);
      setModules(Object.fromEntries(list.map((item) => [item.module_key, item.enabled])));
      setResources((resourceResponse ?? { channels: [], roles: [] }) as { channels: Resource[]; roles: Resource[] });
      setAudit((auditResponse.events ?? []) as AuditEvent[]);
      const generalResponse = await getJson("/api/guilds/" + encodeURIComponent(guild) + "/general");
      setGeneral((generalResponse.settings ?? general) as GeneralSettings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить сервер.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([
      getJson("/api/guilds"),
      getJson("/api/module-schemas")
    ])
      .then(([guildResponse, schemaResponse]) => {
        const list = (guildResponse.guilds ?? []) as Guild[];
        setGuilds(list);
        setGuildId((current) => current || list[0]?.id || "");
        setSchemas((schemaResponse.schemas ?? []) as Schema[]);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Control Center."));
  }, []);

  useEffect(() => {
    if (!guildId) return;
    void loadGuild(guildId);
  }, [guildId]);

  useEffect(() => {
    if (!guildId || !selectedSchema || view === "overview") return;
    let cancelled = false;
    setLoading(true);
    void getJson("/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(view))
      .then((response) => {
        if (cancelled) return;
        const next = (response.values ?? {}) as Record<string, unknown>;
        setValues(next);
        setOriginalValues(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [guildId, view, selectedSchema?.key]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function openView(key: string) {
    clearMessages();
    setView(key);
    setSearch("");
    if (key === "custom-commands" || PANEL_KEYS.has(key) || key === "moderation" || key === "music" || key === "overview") return;
    if (!schemas.some((item) => item.key === key)) return;
  }

  async function toggleModule(key: string, enabled: boolean) {
    setSaving(true);
    clearMessages();
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleKey: key, enabled })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "module_update_failed"));
      setModules((previous) => ({ ...previous, [key]: enabled }));
      setNotice(enabled ? moduleTitle(catalog, key) + " включён." : moduleTitle(catalog, key) + " выключен.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить модуль.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!selectedSchema) return;
    setSaving(true);
    clearMessages();
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(view),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "settings_save_failed"));
      const next = (body.values ?? values) as Record<string, unknown>;
      setValues(next);
      setOriginalValues(next);
      setNotice("Настройки сохранены.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshAudit() {
    if (!guildId) return;
    try {
      const response = await getJson("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=30");
      setAudit((response.events ?? []) as AuditEvent[]);
    } catch {
      // audit is supplementary
    }
  }

  const enabledCount = catalog.filter((item) => modules[item.key]).length;

  return (
    <main style={{ minHeight: "100vh", background: "#0b0f14", color: "#e7ebf1" }}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside style={{ width: 255, flex: "0 0 255px", borderRight: "1px solid #202733", background: "#0c1117", padding: 13, boxSizing: "border-box", position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
          <div style={{ padding: "6px 8px 14px" }}>
            <div style={{ color: "#596577", fontSize: 9, letterSpacing: 1.4 }}>VEXA</div>
            <div style={{ marginTop: 4, fontSize: 18, fontWeight: 760 }}>Server Dashboard</div>
          </div>

          <div style={{ ...panelStyle, padding: 8, marginBottom: 12 }}>
            <div style={{ color: "#687386", fontSize: 9, padding: "0 7px 5px" }}>СЕРВЕР</div>
            <select
              value={guildId}
              onChange={(event) => { setGuildId(event.target.value); setView("overview"); }}
              style={{ ...inputStyle, border: 0, padding: "9px 8px", background: "#0d1218" }}
            >
              {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </div>

          <div style={{ position: "relative", marginBottom: 9 }}>
            <span style={{ position: "absolute", left: 10, top: 9, color: "#5c6778" }}>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск раздела" style={{ ...inputStyle, paddingLeft: 31 }} />
          </div>

          <button type="button" onClick={() => openView("overview")} style={navButton(view === "overview")}>⌂ <span>Обзор</span></button>

          {filteredGroups.filter((group) => group.label !== "Основное").map((group) => (
            <div key={group.label} style={{ marginTop: 13 }}>
              <div style={{ padding: "0 8px 5px", color: "#515d6e", fontSize: 9, letterSpacing: 1.2 }}>{group.label.toUpperCase()}</div>
              {group.items.map(([key, label, icon]) => (
                <NavModule
                  key={key}
                  active={view === key}
                  label={label}
                  icon={icon}
                  enabled={modules[key]}
                  onClick={() => openView(key)}
                />
              ))}
            </div>
          ))}

          <div style={{ marginTop: 14, borderTop: "1px solid #202733", paddingTop: 12 }}>
            <div style={{ padding: "0 8px 5px", color: "#515d6e", fontSize: 9, letterSpacing: 1.2 }}>СИСТЕМА</div>
            {SYSTEM_ITEMS.map(([key, label, icon]) => (
              <NavModule key={key} active={view === key} label={label} icon={icon} onClick={() => openView(key)} />
            ))}
          </div>

          <div style={{ marginTop: 14, padding: "8px 9px", color: "#667183", fontSize: 9, lineHeight: 1.5 }}>
            {enabledCount} модулей включено
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          <header style={{ height: 60, borderBottom: "1px solid #202733", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", boxSizing: "border-box", background: "#0d1218", position: "sticky", top: 0, zIndex: 5 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 720 }}>{selectedGuild?.name ?? "Discord Server"}</div>
              <div style={{ color: "#647082", fontSize: 9, marginTop: 2 }}>Vexa Administration</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#697587", fontSize: 10 }}>{loading ? "Загрузка…" : "Готово"}</span>
            </div>
          </header>

          <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
            {error && <div style={noticeStyle("error")}>{error}</div>}
            {notice && <div style={noticeStyle("success")}>{notice}</div>}

            {view === "overview" && (
              <OverviewPage
                guild={selectedGuild}
                enabledCount={enabledCount}
                catalog={catalog}
                modules={modules}
                onOpen={openView}
              />
            )}

            {view === "moderation" && (
              <ModuleShell title="Модерация" enabled={Boolean(modules.moderation)} onToggle={(value) => void toggleModule("moderation", value)}>
                <ModerationPanel guildId={guildId} resources={resources} onChanged={refreshAudit} />
              </ModuleShell>
            )}

            {view === "automod" && (
              <ModuleShell title="AutoMod" enabled={Boolean(modules.automod)} onToggle={(value) => void toggleModule("automod", value)}>
                <AutoModPanel guildId={guildId} resources={resources} />
              </ModuleShell>
            )}

            {view === "economy" && (
              <ModuleShell title="Economy" enabled={Boolean(modules.economy)} onToggle={(value) => void toggleModule("economy", value)}>
                <EconomyPanel guildId={guildId} roles={resources.roles} />
              </ModuleShell>
            )}

            {view === "music" && selectedSchema && (
              <ModuleShell
                title="Music"
                enabled={Boolean(modules.music)}
                onToggle={(value) => void toggleModule("music", value)}
                saveEnabled={JSON.stringify(values) !== JSON.stringify(originalValues)}
                onSave={() => void saveSettings()}
                saving={saving}
              >
                <MusicPanel
                  guildId={guildId}
                  voiceChannels={resources.channels.filter((item) => item.type === 2 || item.type === 13)}
                  textChannels={resources.channels.filter((item) => item.type === 0)}
                  values={values}
                  onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
                />
              </ModuleShell>
            )}

            {view === "custom-commands" && (
              <ModuleShell title="Custom Commands" enabled={true} onToggle={() => undefined}>
                <CustomCommandsPanel guildId={guildId} resources={resources} />
              </ModuleShell>
            )}

            {view === "roles" && (
              <ModuleShell title="Роли" enabled={Boolean(modules.roles)} onToggle={(value) => void toggleModule("roles", value)}>
                <RolePanelsEditor
                  guildId={guildId}
                  channels={resources.channels.filter((item) => item.type === 0)}
                  roles={resources.roles}
                  onChanged={refreshAudit}
                />
              </ModuleShell>
            )}

            {view === "giveaways" && (
              <ModuleShell title="Giveaways" enabled={Boolean(modules.giveaways)} onToggle={(value) => void toggleModule("giveaways", value)}>
                <GiveawaysPanel guildId={guildId} onChanged={refreshAudit} />
              </ModuleShell>
            )}

            {view === "analytics" && (
              <ModuleShell title="Analytics" enabled={Boolean(modules.analytics)} onToggle={(value) => void toggleModule("analytics", value)}>
                <AnalyticsPanel guildId={guildId} />
              </ModuleShell>
            )}

            {view === "automation" && (
              <ModuleShell title="Automation" enabled={Boolean(modules.automation)} onToggle={(value) => void toggleModule("automation", value)}>
                <AutomationPanel
                  guildId={guildId}
                  channels={resources.channels.filter((item) => item.type === 0)}
                  roles={resources.roles.filter((item) => item.manageable !== false)}
                  onChanged={refreshAudit}
                />
              </ModuleShell>
            )}

            {view === "notifications" && (
              <ModuleShell title="Уведомления" enabled={Boolean(modules.notifications)} onToggle={(value) => void toggleModule("notifications", value)}>
                <NotificationsPanel
                  guildId={guildId}
                  channels={resources.channels.filter((item) => item.type === 0)}
                  onChanged={refreshAudit}
                />
              </ModuleShell>
            )}

            {view === "stream-alerts" && (
              <ModuleShell title="Уведомления о стримах" enabled={Boolean(modules["stream-alerts"])} onToggle={(value) => void toggleModule("stream-alerts", value)}>
                <StreamAlertsPanel
                  guildId={guildId}
                  channels={resources.channels.filter((item) => item.type === 0)}
                  roles={resources.roles.filter((item) => item.manageable !== false)}
                  onChanged={refreshAudit}
                />
              </ModuleShell>
            )}

            {view === "leveling" && selectedSchema && (
              <ModuleShell
                title="Leveling"
                enabled={Boolean(modules.leveling)}
                onToggle={(value) => void toggleModule("leveling", value)}
                saveEnabled={JSON.stringify(values) !== JSON.stringify(originalValues)}
                onSave={() => void saveSettings()}
                saving={saving}
              >
                <LevelingPanel
                  guildId={guildId}
                  values={values}
                  resources={resources}
                  onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
                  onRefresh={refreshAudit}
                />
              </ModuleShell>
            )}

            {view === "welcome" && selectedSchema && (
              <ModuleShell
                title="Welcome & Goodbye"
                enabled={Boolean(modules.welcome)}
                onToggle={(value) => void toggleModule("welcome", value)}
                saveEnabled={JSON.stringify(values) !== JSON.stringify(originalValues)}
                onSave={() => void saveSettings()}
                saving={saving}
              >
                <WelcomePanel
                  values={values}
                  resources={resources}
                  onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
                />
              </ModuleShell>
            )}

            {selectedSchema && !PANEL_KEYS.has(view) && !["overview", "moderation", "music", "leveling", "welcome", "custom-commands", ...SYSTEM_ITEMS.map((item) => item[0])].includes(view) && (
              <ModuleShell
                title={selectedSchema.title}
                enabled={Boolean(modules[view])}
                onToggle={(value) => void toggleModule(view, value)}
                saveEnabled={JSON.stringify(values) !== JSON.stringify(originalValues)}
                onSave={() => void saveSettings()}
                saving={saving}
              >
                <SchemaForm
                  schema={selectedSchema}
                  values={values}
                  resources={resources}
                  onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
                  onAction={async (action) => {
                    if (action.confirmation && !window.confirm(action.confirmation)) return;
                    const response = await fetch(
                      "/api/guilds/" + encodeURIComponent(guildId) + "/actions/" + encodeURIComponent(view) + "/" + encodeURIComponent(action.id),
                      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
                    );
                    if (!response.ok) throw new Error("action_failed");
                    setNotice("Готово.");
                  }}
                />
              </ModuleShell>
            )}

            {view === "settings" && (
              <GeneralSettingsPanel
                guildId={guildId}
                value={general}
                resources={resources}
                onSaved={(next) => setGeneral(next)}
              />
            )}

            {view === "commands" && <CommandPoliciesPanel guildId={guildId} resources={resources} />}

            {view === "fleet" && <FleetPanel guildId={guildId} />}
            {view === "backups" && <BackupPanel guildId={guildId} />}
            {view === "audit" && <AuditPage audit={audit} />}
          </div>
        </section>
      </div>
    </main>
  );
}

function NavModule(props: { active: boolean; label: string; icon: string; enabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "9px 9px",
      margin: "1px 0",
      border: props.active ? "1px solid #2b3442" : "1px solid transparent",
      background: props.active ? "#171d26" : "transparent",
      color: props.active ? "#f6f8fb" : "#c5cbd4",
      borderRadius: 9,
      cursor: "pointer",
      textAlign: "left"
    }}>
      <span style={{ width: 18, color: props.active ? "#aeb8ff" : "#788496", textAlign: "center" }}>{props.icon}</span>
      <span style={{ flex: 1, fontSize: 11, fontWeight: props.active ? 680 : 520 }}>{props.label}</span>
      {props.enabled !== undefined && <span style={{ width: 6, height: 6, borderRadius: 99, background: props.enabled ? "#72d695" : "#465162" }} />}
    </button>
  );
}

function ModuleShell(props: {
  title: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  saveEnabled?: boolean;
  onSave?: () => void;
  saving?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25 }}>{props.title}</h1>
          <div style={{ marginTop: 5, color: "#6d7889", fontSize: 10 }}>Настройки и действия модуля</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {props.saveEnabled && props.onSave && <button type="button" onClick={props.onSave} disabled={props.saving} style={button("primary")}>Сохранить</button>}
          <button type="button" onClick={() => props.onToggle(!props.enabled)} style={button(props.enabled ? "danger" : "primary")}>
            {props.enabled ? "Выключить" : "Включить"}
          </button>
        </div>
      </div>
      {props.children}
    </div>
  );
}

function OverviewPage(props: {
  guild?: Guild;
  enabledCount: number;
  catalog: CatalogItem[];
  modules: ModuleState;
  onOpen: (key: string) => void;
}) {
  const active = props.catalog.filter((item) => props.modules[item.key]);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{ ...panelStyle, padding: 24 }}>
        <div style={{ color: "#647184", fontSize: 9, letterSpacing: 1.3 }}>SERVER OVERVIEW</div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 30 }}>{props.guild?.name ?? "Discord Server"}</h1>
        <div style={{ color: "#778394", fontSize: 11 }}>Управление ботом, модулями и их настройками в одном месте.</div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
        <Stat label="Участники" value={formatNumber(props.guild?.memberCount)} />
        <Stat label="Модули" value={String(props.enabledCount)} />
        <Stat label="Каналы" value={formatNumber(props.guild?.channelCount)} />
        <Stat label="Роли" value={formatNumber(props.guild?.roleCount)} />
      </div>

      <section style={{ ...panelStyle, padding: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 11 }}>Активные модули</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          {active.map((item) => (
            <button key={item.key} type="button" onClick={() => props.onOpen(item.key)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: 12, background: "#0d1218", border: "1px solid #232b36", borderRadius: 10, color: "#edf1f6", cursor: "pointer", textAlign: "left"
            }}>
              <span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 12 }}>{item.title}</strong><span style={{ display: "block", marginTop: 3, color: "#657184", fontSize: 9 }}>{item.description}</span></span>
              <span style={{ color: "#606d7f" }}>→</span>
            </button>
          ))}
          {!active.length && <div style={{ color: "#687487", fontSize: 10 }}>Нет включённых модулей.</div>}
        </div>
      </section>
    </div>
  );
}

function GeneralSettingsPanel(props: {
  guildId: string;
  value: GeneralSettings;
  resources: { channels: Resource[]; roles: Resource[] };
  onSaved: (value: GeneralSettings) => void;
}) {
  const [value, setValue] = useState<GeneralSettings>(props.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setValue(props.value), [props.value]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? "general_settings_failed"));
      const next = body.settings as GeneralSettings;
      setValue(next);
      props.onSaved(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error && <div style={noticeStyle("error")}>{error}</div>}
      <section style={{ ...panelStyle, padding: 17 }}>
        <h1 style={{ margin: 0, fontSize: 21 }}>Общие настройки</h1>
        <div style={{ marginTop: 4, color: "#667386", fontSize: 9 }}>Префикс, язык, часовой пояс и права специальных ролей.</div>
      </section>

      <section style={{ ...panelStyle, padding: 17 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FieldInput label="Префикс" value={value.commandPrefix} onChange={(next) => setValue((v) => ({ ...v, commandPrefix: next }))} placeholder="!" />
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Язык</span>
            <select value={value.locale} onChange={(event) => setValue((v) => ({ ...v, locale: event.target.value }))} style={inputStyle}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <FieldInput label="Timezone" value={value.timezone} onChange={(next) => setValue((v) => ({ ...v, timezone: next }))} placeholder="Europe/Berlin" />
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>DJ роль</span>
            <select value={value.djRoleId ?? ""} onChange={(event) => setValue((v) => ({ ...v, djRoleId: event.target.value || null }))} style={inputStyle}>
              <option value="">Нет отдельной DJ роли</option>
              {props.resources.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Канал логов по умолчанию</span>
            <select value={value.defaultLogChannelId ?? ""} onChange={(event) => setValue((v) => ({ ...v, defaultLogChannelId: event.target.value || null }))} style={inputStyle}>
              <option value="">Не выбран</option>
              {props.resources.channels.filter((channel) => channel.type === 0).map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: "grid", gap: 6, marginTop: 12 }}><span style={labelStyle}>Роли модераторов</span>
          <select multiple value={value.moderatorRoleIds} onChange={(event) => setValue((v) => ({ ...v, moderatorRoleIds: [...event.target.selectedOptions].map((item) => item.value) }))} style={{ ...inputStyle, minHeight: 120 }}>
            {props.resources.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
        <div style={{ marginTop: 12 }}>
          <Toggle label="Публиковать Audit события в Discord" checked={value.auditLogEnabled} onChange={(next) => setValue((v) => ({ ...v, auditLogEnabled: next }))} />
        </div>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" disabled={saving} onClick={() => void save()} style={button("primary")}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </section>
    </div>
  );
}

function CommandPoliciesPanel(props: { guildId: string; resources: { channels: Resource[]; roles: Resource[] } }) {
  type Policy = {
    commandName: string;
    label: string;
    module: string;
    enabled: boolean;
    prefixEnabled: boolean;
    slashEnabled: boolean;
    cooldownSeconds: number;
    allowedRoleIds: string[];
    deniedRoleIds: string[];
    allowedChannelIds: string[];
    deniedChannelIds: string[];
    helpVisible: boolean;
  };

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/command-policies", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "command_policies_failed"));
    setPolicies((body.policies ?? []) as Policy[]);
  }

  useEffect(() => { void load().catch(() => undefined); }, [props.guildId]);

  const filtered = policies.filter((item) => {
    const hay = (item.commandName + " " + item.label + " " + item.module).toLocaleLowerCase();
    return hay.includes(query.toLocaleLowerCase());
  });

  async function save(policy: Policy) {
    setBusy(true);
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/command-policies/" + encodeURIComponent(policy.commandName),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(policy)
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "command_policy_failed"));
      setPolicies((previous) => previous.map((item) => item.commandName === policy.commandName ? { ...item, ...(body.policy ?? policy) } : item));
    } finally {
      setBusy(false);
    }
  }

  const current = policies.find((item) => item.commandName === selected) ?? filtered[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 12 }}>
      <section style={{ ...panelStyle, padding: 10 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск команды" style={inputStyle} />
        <div style={{ display: "grid", gap: 3, marginTop: 9 }}>
          {filtered.map((item) => (
            <button key={item.commandName} type="button" onClick={() => setSelected(item.commandName)} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", border: 0, borderRadius: 8,
              padding: "9px 8px", background: (current?.commandName === item.commandName) ? "#171d26" : "transparent",
              color: "#dfe4ec", cursor: "pointer", textAlign: "left"
            }}>
              <span style={{ flex: 1, fontSize: 10 }}>{item.label}</span>
              <span style={{ color: "#657184", fontSize: 8 }}>{item.commandName}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 17 }}>
        {current ? (
          <CommandPolicyEditor
            policy={current}
            resources={props.resources}
            busy={busy}
            onChange={(patch) => setPolicies((previous) => previous.map((item) => item.commandName === current.commandName ? { ...item, ...patch } : item))}
            onSave={() => void save(current)}
          />
        ) : (
          <div style={{ color: "#687486", fontSize: 10 }}>Команды не найдены.</div>
        )}
      </section>
    </div>
  );
}

type CommandPolicy = {
  commandName: string;
  label: string;
  module: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  cooldownSeconds: number;
  allowedRoleIds: string[];
  deniedRoleIds: string[];
  allowedChannelIds: string[];
  deniedChannelIds: string[];
  helpVisible: boolean;
};

function CommandPolicyEditor(props: {
  policy: CommandPolicy;
  resources: { channels: Resource[]; roles: Resource[] };
  busy: boolean;
  onChange: (patch: Partial<CommandPolicy>) => void;
  onSave: () => void;
}) {
  const policy = props.policy;
  const setIds = (key: "allowedRoleIds" | "deniedRoleIds" | "allowedChannelIds" | "deniedChannelIds", event: ChangeEvent<HTMLSelectElement>) =>
    props.onChange({ [key]: [...event.target.selectedOptions].map((item) => item.value) } as Partial<typeof policy>);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 21 }}>{policy.label}</h1>
        <div style={{ marginTop: 4, color: "#667286", fontSize: 9 }}>/{policy.commandName} · {policy.module}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        <Toggle label="Команда включена" checked={policy.enabled} onChange={(value) => props.onChange({ enabled: value })} />
        <Toggle label="Показывать в help" checked={policy.helpVisible} onChange={(value) => props.onChange({ helpVisible: value })} />
        <Toggle label="Prefix" checked={policy.prefixEnabled} onChange={(value) => props.onChange({ prefixEnabled: value })} />
        <Toggle label="Slash" checked={policy.slashEnabled} onChange={(value) => props.onChange({ slashEnabled: value })} />
      </div>

      <FieldInput label="Cooldown, сек." value={String(policy.cooldownSeconds)} onChange={(value) => props.onChange({ cooldownSeconds: Number(value) })} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <MultiSelect label="Разрешённые роли" value={policy.allowedRoleIds} options={props.resources.roles} onChange={(e) => setIds("allowedRoleIds", e)} />
        <MultiSelect label="Запрещённые роли" value={policy.deniedRoleIds} options={props.resources.roles} onChange={(e) => setIds("deniedRoleIds", e)} />
        <MultiSelect label="Разрешённые каналы" value={policy.allowedChannelIds} options={props.resources.channels.filter((x) => x.type === 0)} onChange={(e) => setIds("allowedChannelIds", e)} />
        <MultiSelect label="Запрещённые каналы" value={policy.deniedChannelIds} options={props.resources.channels.filter((x) => x.type === 0)} onChange={(e) => setIds("deniedChannelIds", e)} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" disabled={props.busy} onClick={props.onSave} style={button("primary")}>{props.busy ? "Сохранение…" : "Сохранить"}</button>
      </div>
    </div>
  );
}

function MultiSelect(props: {
  label: string;
  value: string[];
  options: Resource[];
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={labelStyle}>{props.label}</span>
      <select multiple value={props.value} onChange={props.onChange} style={{ ...inputStyle, minHeight: 115 }}>
        {props.options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  );
}

function AutoModPanel(props: {
  guildId: string;
  resources: { channels: Resource[]; roles: Resource[] };
}) {
  type Rule = {
    id: number;
    detector: string;
    enabled: boolean;
    threshold: number | null;
    windowSeconds: number | null;
    action: "delete" | "timeout" | "warn" | "log";
    timeoutMinutes: number;
    affectedRoleIds: string[];
    ignoredRoleIds: string[];
    affectedChannelIds: string[];
    ignoredChannelIds: string[];
    ignoreModerators: boolean;
    messageTemplate: string;
  };

  const detectors = [
    ["bad-words", "Плохие слова"],
    ["links", "Ссылки"],
    ["invites", "Discord invites"],
    ["scam", "Scam / phishing"],
    ["repeated-text", "Повторяемый текст"],
    ["caps", "CAPS"],
    ["emotes", "Emoji spam"],
    ["mentions", "Mass mentions"],
    ["zalgo", "Zalgo"],
    ["honeypot", "Honeypot"],
    ["line-length", "Длинные строки"],
    ["link-count", "Много ссылок"],
    ["mention-count", "Много упоминаний"],
    ["emoji-count", "Много emoji"]
  ] as const;

  const [rules, setRules] = useState<Rule[]>([]);
  const [selected, setSelected] = useState("bad-words");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "automod_rules_failed"));
    setRules((body.rules ?? []) as Rule[]);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить AutoMod."));
  }, [props.guildId]);

  const current = rules.find((rule) => rule.detector === selected) ?? {
    id: 0,
    detector: selected,
    enabled: false,
    threshold: null,
    windowSeconds: null,
    action: "delete" as const,
    timeoutMinutes: 0,
    affectedRoleIds: [],
    ignoredRoleIds: [],
    affectedChannelIds: [],
    ignoredChannelIds: [],
    ignoreModerators: true,
    messageTemplate: ""
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "automod_rule_save_failed"));
      setRules((body.rules ?? []) as Rule[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить правило.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current.id) return;
    if (!window.confirm("Удалить правило AutoMod?")) return;
    setBusy(true);
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules/" + current.id,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("automod_rule_delete_failed");
      setRules((previous) => previous.filter((rule) => rule.id !== current.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить правило.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (next: Partial<Rule>) =>
    setRules((previous) => {
      const exists = previous.some((rule) => rule.detector === selected);
      const nextRule = { ...current, ...next };
      return exists
        ? previous.map((rule) => rule.detector === selected ? nextRule : rule)
        : [...previous, nextRule];
    });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 12 }}>
      <section style={{ ...panelStyle, padding: 9 }}>
        {detectors.map(([key, label]) => {
          const rule = rules.find((item) => item.detector === key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 8px",
                margin: "1px 0",
                border: 0,
                borderRadius: 8,
                background: selected === key ? "#171d26" : "transparent",
                color: "#dfe5ed",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span style={{ flex: 1, fontSize: 10 }}>{label}</span>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: rule?.enabled ? "#6fd190" : "#465162" }} />
            </button>
          );
        })}
      </section>

      <section style={{ ...panelStyle, padding: 17 }}>
        {error && <div style={noticeStyle("error")}>{error}</div>}
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>{detectors.find(([key]) => key === selected)?.[1] ?? selected}</h2>
              <div style={{ marginTop: 3, color: "#667386", fontSize: 9 }}>Detector → scope → action → punishment → logging</div>
            </div>
            <Toggle label="Включено" checked={current.enabled} onChange={(value) => patch({ enabled: value })} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldInput label="Порог" value={current.threshold === null ? "" : String(current.threshold)} onChange={(value) => patch({ threshold: value === "" ? null : Number(value) })} placeholder="например 6" />
            <FieldInput label="Окно, сек." value={current.windowSeconds === null ? "" : String(current.windowSeconds)} onChange={(value) => patch({ windowSeconds: value === "" ? null : Number(value) })} placeholder="например 10" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Действие</span>
              <select value={current.action} onChange={(event) => patch({ action: event.target.value as Rule["action"] })} style={inputStyle}>
                <option value="delete">Удалить сообщение</option>
                <option value="timeout">Удалить + Timeout</option>
                <option value="warn">Удалить + Warn</option>
                <option value="log">Только журнал</option>
              </select>
            </label>
            <FieldInput label="Timeout, мин." value={String(current.timeoutMinutes)} onChange={(value) => patch({ timeoutMinutes: Number(value) })} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <MultiSelect label="Применять к ролям" value={current.affectedRoleIds} options={props.resources.roles} onChange={(event) => patch({ affectedRoleIds: [...event.target.selectedOptions].map((x) => x.value) })} />
            <MultiSelect label="Игнорировать роли" value={current.ignoredRoleIds} options={props.resources.roles} onChange={(event) => patch({ ignoredRoleIds: [...event.target.selectedOptions].map((x) => x.value) })} />
            <MultiSelect label="Применять в каналах" value={current.affectedChannelIds} options={props.resources.channels.filter((x) => x.type === 0)} onChange={(event) => patch({ affectedChannelIds: [...event.target.selectedOptions].map((x) => x.value) })} />
            <MultiSelect label="Игнорировать каналы" value={current.ignoredChannelIds} options={props.resources.channels.filter((x) => x.type === 0)} onChange={(event) => patch({ ignoredChannelIds: [...event.target.selectedOptions].map((x) => x.value) })} />
          </div>

          <Toggle label="Игнорировать модераторов/администраторов" checked={current.ignoreModerators} onChange={(value) => patch({ ignoreModerators: value })} />

          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Сообщение при срабатывании</span>
            <textarea value={current.messageTemplate} onChange={(event) => patch({ messageTemplate: event.target.value })} placeholder="⚠️ {mention}, сообщение удалено." style={{ ...inputStyle, minHeight: 85, resize: "vertical" }} />
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {current.id && <button type="button" disabled={busy} onClick={() => void remove()} style={button("danger")}>Удалить правило</button>}
            <button type="button" disabled={busy} onClick={() => void save()} style={button("primary")}>{busy ? "Сохранение…" : "Сохранить правило"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function EconomyPanel(props: { guildId: string; roles: Resource[] }) {
  type Item = { id: number; name: string; description: string; price: string; roleId: string | null; stock: number | null; enabled: boolean };
  const empty = { id: 0, name: "", description: "", price: "100", roleId: null, stock: null, enabled: true };
  const [items,setItems]=useState<Item[]>([]);
  const [current,setCurrent]=useState<Item>(empty);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  async function load() {
    const response=await fetch("/api/guilds/"+encodeURIComponent(props.guildId)+"/economy/items",{cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(body.error ?? "economy_items_failed"));
    setItems((body.items ?? []) as Item[]);
  }
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Не удалось загрузить магазин."));},[props.guildId]);

  async function save() {
    setSaving(true); setError("");
    try {
      const payload={name:current.name,description:current.description,price:Number(current.price),roleId:current.roleId,stock:current.stock,enabled:current.enabled};
      const response=await fetch("/api/guilds/"+encodeURIComponent(props.guildId)+"/economy/items"+(current.id?"/"+current.id:""),{
        method:current.id?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(String(body.error ?? "economy_save_failed"));
      setItems((body.items ?? []) as Item[]);
      setCurrent(empty);
    } catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить товар.");}
    finally{setSaving(false);}
  }

  async function remove(id:number) {
    if(!window.confirm("Удалить товар?")) return;
    const response=await fetch("/api/guilds/"+encodeURIComponent(props.guildId)+"/economy/items/"+id,{method:"DELETE"});
    if(!response.ok){setError("Не удалось удалить товар.");return;}
    setItems(previous=>previous.filter(item=>item.id!==id));
    if(current.id===id) setCurrent(empty);
  }

  return (
    <div style={{display:"grid",gap:13}}>
      {error && <div style={noticeStyle("error")}>{error}</div>}
      <section style={{...panelStyle,padding:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FieldInput label="Название" value={current.name} onChange={value=>setCurrent(p=>({...p,name:value}))} placeholder="VIP Role"/>
          <FieldInput label="Цена" value={current.price} onChange={value=>setCurrent(p=>({...p,price:value}))} />
          <label style={{display:"grid",gap:6}}><span style={labelStyle}>Описание</span><textarea value={current.description} onChange={e=>setCurrent(p=>({...p,description:e.target.value}))} style={{...inputStyle,minHeight:80}} /></label>
          <label style={{display:"grid",gap:6}}><span style={labelStyle}>Роль после покупки</span>
            <select value={current.roleId ?? ""} onChange={e=>setCurrent(p=>({...p,roleId:e.target.value||null}))} style={inputStyle}>
              <option value="">Без роли</option>{props.roles.filter(r=>r.manageable!==false).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <FieldInput label="Stock (пусто = unlimited)" value={current.stock===null?"":String(current.stock)} onChange={value=>setCurrent(p=>({...p,stock:value===""?null:Number(value)}))} />
          <Toggle label="Товар активен" checked={current.enabled} onChange={value=>setCurrent(p=>({...p,enabled:value}))}/>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}>
          {current.id!==0 && <button type="button" onClick={()=>setCurrent(empty)} style={button("secondary")}>Новый</button>}
          <button type="button" disabled={saving} onClick={()=>void save()} style={button("primary")}>{saving?"Сохранение…":"Сохранить товар"}</button>
        </div>
      </section>
      <section style={{...panelStyle,padding:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Магазин</div>
        <div style={{display:"grid",gap:7}}>
          {items.map(item=><div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 11px",background:"#0d1218",border:"1px solid #232b36",borderRadius:9}}>
            <span style={{width:34,color:"#667486",fontSize:9}}>#{item.id}</span>
            <span style={{flex:1}}><strong style={{fontSize:11}}>{item.name}</strong><span style={{display:"block",marginTop:2,color:"#647184",fontSize:9}}>{item.description}</span></span>
            <span style={{fontSize:10}}>{item.price} coins</span>
            <button type="button" onClick={()=>setCurrent(item)} style={button("secondary")}>Изменить</button>
            <button type="button" onClick={()=>void remove(item.id)} style={button("danger")}>Удалить</button>
          </div>)}
          {!items.length && <div style={{color:"#697587",fontSize:10}}>Магазин пока пуст.</div>}
        </div>
      </section>
    </div>
  );
}

function WelcomePanel(props: {
  values: Record<string, unknown>;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (key: string, value: unknown) => void;
}) {
  const message = String(props.values.message ?? "Добро пожаловать, {mention}, на {server}!");
  const goodbyeMessage = String(props.values.goodbyeMessage ?? "{user} покинул {server}.");
  const renderPreview = (text: string, user: string) => text.replaceAll("{mention}", "@New Member").replaceAll("{user}", user).replaceAll("{server}", "Vexa Test Server").replaceAll("{channel}", "#welcome");
  const selectedStarterRoles = String(props.values.starterRoleIds ?? "").split(/[,\\s]+/).filter(Boolean);
  return (
    <div style={{ display: "grid", gap: 13 }}>
      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Welcome-канал</span><select value={String(props.values.channelId ?? "")} onChange={(event) => props.onChange("channelId", event.target.value || null)} style={inputStyle}><option value="">Не выбран</option>{props.resources.channels.filter((x) => x.type === 0).map((x) => <option key={x.id} value={x.id}>#{x.name}</option>)}</select></label>
          <Toggle label="Отправлять в ЛС" checked={props.values.dm === true} onChange={(v) => props.onChange("dm", v)} />
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Сообщение</span><textarea value={message} onChange={(event) => props.onChange("message", event.target.value)} style={{ ...inputStyle, minHeight: 135, resize: "vertical" }} /><span style={helpStyle}>Переменные: {`{mention}`} {`{user}`} {`{server}`} {`{channel}`}</span></label>
          <div style={{ display: "grid", gap: 8 }}><Toggle label="Embed" checked={props.values.embed !== false} onChange={(v) => props.onChange("embed", v)} /><div style={{ border: "1px solid #283140", borderRadius: 12, padding: 13, background: "#171d27" }}><div style={{ color: "#78869b", fontSize: 8, letterSpacing: 1.2 }}>PREVIEW</div><div style={{ marginTop: 7, fontSize: 13, fontWeight: 700 }}>Добро пожаловать!</div><div style={{ marginTop: 5, color: "#c2c9d4", fontSize: 10, lineHeight: 1.45 }}>{renderPreview(message, "New Member")}</div></div></div>
        </div>
      </section>
      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Goodbye-канал</span><select value={String(props.values.goodbyeChannelId ?? "")} onChange={(event) => props.onChange("goodbyeChannelId", event.target.value || null)} style={inputStyle}><option value="">Использовать Welcome-канал</option>{props.resources.channels.filter((x) => x.type === 0).map((x) => <option key={x.id} value={x.id}>#{x.name}</option>)}</select></label>
          <Toggle label="Goodbye включён" checked={props.values.goodbyeEnabled === true} onChange={(v) => props.onChange("goodbyeEnabled", v)} />
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Goodbye-сообщение</span><textarea value={goodbyeMessage} onChange={(event) => props.onChange("goodbyeMessage", event.target.value)} style={{ ...inputStyle, minHeight: 110, resize: "vertical" }} /></label>
          <div style={{ display: "grid", gap: 8 }}><Toggle label="Goodbye Embed" checked={props.values.goodbyeEmbed !== false} onChange={(v) => props.onChange("goodbyeEmbed", v)} /><div style={{ border: "1px solid #283140", borderRadius: 12, padding: 13, background: "#171d27", color: "#c2c9d4", fontSize: 10 }}>{renderPreview(goodbyeMessage, "Leaving Member")}</div></div>
        </div>
      </section>
      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Стартовые роли</span><select multiple value={selectedStarterRoles} onChange={(event) => props.onChange("starterRoleIds", [...event.target.selectedOptions].map((x) => x.value).join(","))} style={{ ...inputStyle, minHeight: 130 }}>{props.resources.roles.filter((x) => x.manageable !== false).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <div style={{ display: "grid", gap: 9 }}><Toggle label="Восстанавливать роли вернувшимся" checked={props.values.restoreRoles === true} onChange={(v) => props.onChange("restoreRoles", v)} /><div style={{ padding: 12, background: "#0d1218", border: "1px solid #232b36", borderRadius: 10, color: "#6d798b", fontSize: 9, lineHeight: 1.55 }}>При выходе Vexa сохраняет управляемые роли. При повторном входе они восстанавливаются вместе со стартовыми.</div></div>
        </div>
      </section>
    </div>
  );
}

function LevelingPanel(props: {
  guildId: string;
  values: Record<string, unknown>;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (key: string, value: unknown) => void;
  onRefresh: () => void;
}) {
  const [rewards, setRewards] = useState<Array<{ level: number; roleId: string; removePrevious: boolean; dmUser: boolean; message: string }>>([]);
  const [exclusions, setExclusions] = useState<Array<{ kind: "role" | "channel"; refId: string }>>([]);
  const [rewardLevel, setRewardLevel] = useState("1");
  const [rewardRole, setRewardRole] = useState("");
  const [rewardRemovePrevious, setRewardRemovePrevious] = useState(true);
  const [rewardDm, setRewardDm] = useState(false);
  const [rewardMessage, setRewardMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/leveling", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "leveling_failed"));
    setRewards((body.rewards ?? []) as typeof rewards);
    setExclusions((body.exclusions ?? []) as typeof exclusions);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Leveling."));
  }, [props.guildId]);

  async function saveReward() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/leveling/rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          level: Number(rewardLevel),
          roleId: rewardRole,
          removePrevious: rewardRemovePrevious,
          dmUser: rewardDm,
          message: rewardMessage
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? "reward_failed"));
      setRewards((body.rewards ?? []) as typeof rewards);
      setRewardMessage("");
      props.onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteReward(level: number) {
    if (!window.confirm("Удалить награду этого уровня?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/leveling/rewards/" + level, { method: "DELETE" });
      if (!response.ok) throw new Error("reward_delete_failed");
      setRewards((previous) => previous.filter((item) => item.level !== level));
      props.onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function setExclusion(kind: "role" | "channel", refId: string, enabled: boolean) {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/leveling", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, refId, enabled })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "exclusion_failed"));
    setExclusions((body.exclusions ?? []) as typeof exclusions);
  }

  const selectedRole = props.resources.roles.find((item) => item.id === rewardRole);

  return (
    <div style={{ display: "grid", gap: 13 }}>
      {error && <div style={noticeStyle("error")}>{error}</div>}

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>XP и прогресс</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          <FieldInput label="XP за сообщение" value={String(props.values.xpPerMessage ?? 10)} onChange={(value) => props.onChange("xpPerMessage", Number(value))} />
          <FieldInput label="Cooldown, сек." value={String(props.values.cooldownSeconds ?? 30)} onChange={(value) => props.onChange("cooldownSeconds", Number(value))} />
          <FieldInput label="Лимит XP / день (0 = без лимита)" value={String(props.values.dailyXpCap ?? 0)} onChange={(value) => props.onChange("dailyXpCap", Number(value))} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 10 }}>
          <Toggle label="Объявлять Level Up" checked={props.values.announceLevelUp !== false} onChange={(value) => props.onChange("announceLevelUp", value)} />
          <Toggle label="Voice XP" checked={props.values.voiceEnabled !== false} onChange={(value) => props.onChange("voiceEnabled", value)} />
          <FieldInput label="Voice XP / минуту" value={String(props.values.voiceXpPerMinute ?? 5)} onChange={(value) => props.onChange("voiceXpPerMinute", Number(value))} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 10 }}>
          <Toggle label="Не считать AFK" checked={props.values.voiceIgnoreAfk !== false} onChange={(value) => props.onChange("voiceIgnoreAfk", value)} />
          <FieldInput label="Мин. участников в voice" value={String(props.values.voiceMinMembers ?? 1)} onChange={(value) => props.onChange("voiceMinMembers", Number(value))} />
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Исключения XP</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Каналы без XP</span>
            <select multiple value={exclusions.filter((item) => item.kind === "channel").map((item) => item.refId)} onChange={(event) => {
              const selected = new Set([...event.target.selectedOptions].map((item) => item.value));
              const current = new Set(exclusions.filter((item) => item.kind === "channel").map((item) => item.refId));
              const changes = [
                ...[...selected].filter((id) => !current.has(id)).map((id) => setExclusion("channel", id, true)),
                ...[...current].filter((id) => !selected.has(id)).map((id) => setExclusion("channel", id, false))
              ];
              void Promise.all(changes).catch((reason) => setError(reason instanceof Error ? reason.message : "exclusion_failed"));
            }} style={{ ...inputStyle, minHeight: 140 }}>
              {props.resources.channels.filter((item) => item.type === 0).map((item) => <option key={item.id} value={item.id}>#{item.name}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Роли без XP</span>
            <select multiple value={exclusions.filter((item) => item.kind === "role").map((item) => item.refId)} onChange={(event) => {
              const selected = new Set([...event.target.selectedOptions].map((item) => item.value));
              const current = new Set(exclusions.filter((item) => item.kind === "role").map((item) => item.refId));
              const changes = [
                ...[...selected].filter((id) => !current.has(id)).map((id) => setExclusion("role", id, true)),
                ...[...current].filter((id) => !selected.has(id)).map((id) => setExclusion("role", id, false))
              ];
              void Promise.all(changes).catch((reason) => setError(reason instanceof Error ? reason.message : "exclusion_failed"));
            }} style={{ ...inputStyle, minHeight: 140 }}>
              {props.resources.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Награды за уровни</div>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px", gap: 9, alignItems: "end" }}>
          <FieldInput label="Уровень" value={rewardLevel} onChange={setRewardLevel} />
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Роль</span>
            <select value={rewardRole} onChange={(event) => setRewardRole(event.target.value)} style={inputStyle}>
              <option value="">Выбери роль</option>
              {props.resources.roles.filter((role) => role.manageable !== false).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !rewardRole} onClick={() => void saveReward().catch((reason) => setError(reason instanceof Error ? reason.message : "reward_failed"))} style={button("primary")}>Добавить</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 9 }}>
          <Toggle label="Снимать предыдущую награду" checked={rewardRemovePrevious} onChange={setRewardRemovePrevious} />
          <Toggle label="Отправлять в ЛС" checked={rewardDm} onChange={setRewardDm} />
        </div>
        <label style={{ display: "grid", gap: 6, marginTop: 9 }}><span style={labelStyle}>Сообщение ЛС</span>
          <input value={rewardMessage} onChange={(event) => setRewardMessage(event.target.value)} placeholder="Поздравляем! Ты достиг {level} уровня." style={inputStyle} />
        </label>

        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {rewards.map((reward) => (
            <div key={reward.level} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", background: "#0d1218", border: "1px solid #232b36", borderRadius: 9 }}>
              <strong style={{ width: 58, fontSize: 10 }}>Lv {reward.level}</strong>
              <span style={{ flex: 1, fontSize: 10 }}>{props.resources.roles.find((item) => item.id === reward.roleId)?.name ?? reward.roleId}</span>
              <span style={{ color: "#657184", fontSize: 9 }}>{reward.removePrevious ? "replace" : "stack"}{reward.dmUser ? " · DM" : ""}</span>
              <button type="button" disabled={busy} onClick={() => void deleteReward(reward.level).catch((reason) => setError(reason instanceof Error ? reason.message : "reward_delete_failed"))} style={button("danger")}>Удалить</button>
            </div>
          ))}
          {!rewards.length && <div style={{ color: "#687487", fontSize: 10 }}>Наград пока нет.</div>}
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Предпросмотр rank</div>
        <div style={{ borderRadius: 14, padding: 16, background: "linear-gradient(135deg,#1a2030,#10141b)", border: "1px solid #2a3240", maxWidth: 520 }}>
          <div style={{ fontSize: 10, color: "#7f8ca0" }}>VEXA LEVELING</div>
          <div style={{ marginTop: 5, fontSize: 20, fontWeight: 780 }}>Level 12</div>
          <div style={{ marginTop: 3, color: "#707d90", fontSize: 9 }}>Demo User</div>
          <div style={{ marginTop: 13, height: 9, borderRadius: 99, background: "#080c11", overflow: "hidden" }}><div style={{ width: "68%", height: "100%", background: "#6576d9" }} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, color: "#7b8798", fontSize: 9 }}><span>1,620 XP</span><span>2,400 XP</span><span>#7</span></div>
        </div>
      </section>
    </div>
  );
}

function SchemaForm(props: {
  schema: Schema;
  values: Record<string, unknown>;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (key: string, value: unknown) => void;
  onAction: (action: { id: string; label: string; confirmation?: string }) => void | Promise<void>;
}) {
  const fields = props.schema.fields;
  return (
    <div style={{ ...panelStyle, padding: 18 }}>
      <div style={{ display: "grid", gap: 12 }}>
        {fields.map((field) => (
          <FieldEditor key={field.key} field={field} value={props.values[field.key]} resources={props.resources} onChange={(value) => props.onChange(field.key, value)} />
        ))}
      </div>
      {!!props.schema.actions?.length && (
        <div style={{ marginTop: 18, paddingTop: 15, borderTop: "1px solid #222a35" }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 9 }}>Действия</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {props.schema.actions.map((action) => (
              <button key={action.id} type="button" onClick={() => void props.onAction(action)} style={button(action.kind === "danger" ? "danger" : "secondary")}>{action.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldEditor(props: {
  field: Field;
  value: unknown;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (value: unknown) => void;
}) {
  const field = props.field;
  if (field.type === "boolean") {
    const checked = props.value === true;
    return (
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 12, background: "#0d1218", border: "1px solid #232b36", borderRadius: 10 }}>
        <span><strong style={{ fontSize: 11 }}>{field.label}</strong>{field.description && <span style={{ display: "block", marginTop: 3, color: "#657184", fontSize: 9 }}>{field.description}</span>}</span>
        <input type="checkbox" checked={checked} onChange={(event) => props.onChange(event.target.checked)} />
      </label>
    );
  }

  if (field.type === "channel" || field.type === "role") {
    const source = field.type === "channel"
      ? props.resources.channels
      : props.resources.roles;
    return (
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 680 }}>{field.label}</span>
        <select value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || null)} style={inputStyle}>
          <option value="">Не выбрано</option>
          {source.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {field.description && <span style={{ color: "#647184", fontSize: 9 }}>{field.description}</span>}
      </label>
    );
  }

  const type = field.type === "number" ? "number" : "text";
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 680 }}>{field.label}</span>
      {field.type === "textarea" ? (
        <textarea value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value)} style={{ ...inputStyle, minHeight: 110, resize: "vertical" }} />
      ) : (
        <input
          type={type}
          value={String(props.value ?? "")}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => props.onChange(field.type === "number" ? Number(event.target.value) : event.target.value)}
          style={inputStyle}
        />
      )}
      {field.description && <span style={{ color: "#647184", fontSize: 9 }}>{field.description}</span>}
    </label>
  );
}

function ModerationPanel(props: {
  guildId: string;
  resources: { channels: Resource[]; roles: Resource[] };
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState<"warn" | "timeout" | "kick" | "ban" | "unban">("ban");
  const [duration, setDuration] = useState("1h");
  const [reason, setReason] = useState("Нарушение правил");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AuditEvent[]>([]);

  async function loadMembers(query = "") {
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(props.guildId) + "/members?search=" + encodeURIComponent(query) + "&limit=80",
      { cache: "no-store" }
    );
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "members_failed"));
    setMembers((body.members ?? []) as Member[]);
  }

  useEffect(() => { void loadMembers().catch(() => undefined); }, [props.guildId]);

  async function execute() {
    if (!targetId) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action, targetUserId: targetId, reason };
      if (duration.trim() && (action === "ban" || action === "timeout")) {
        body.durationMinutes = parseDuration(duration.trim());
      }
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error ?? "moderation_failed"));
      setTargetId("");
      setReason("Нарушение правил");
      await loadMembers(search);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  const [caseHistory, setCaseHistory] = useState<Array<{ id: number; action: string; reason: string | null; createdAt: string; expiresAt: string | null }>>([]);

  useEffect(() => {
    if (!targetId) {
      setCaseHistory([]);
      return;
    }
    void fetch(
      "/api/guilds/" + encodeURIComponent(props.guildId) + "/moderation/history?userId=" + encodeURIComponent(targetId),
      { cache: "no-store" }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(body.error ?? "history_failed"));
        setCaseHistory((body.cases ?? []) as typeof caseHistory);
      })
      .catch(() => setCaseHistory([]));
  }, [props.guildId, targetId]);

  const target = members.find((item) => item.id === targetId);
  return (
    <div style={{ display: "grid", gap: 13 }}>
      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1.4fr) minmax(160px,.6fr)", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Участник</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); void loadMembers(event.target.value); }} placeholder="Ник, username или ID" style={inputStyle} />
            <select size={6} value={targetId} onChange={(event) => setTargetId(event.target.value)} style={{ ...inputStyle, minHeight: 150 }}>
              {members.map((member) => <option key={member.id} value={member.id}>{member.displayName} (@{member.username})</option>)}
            </select>
          </label>

          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Действие</span>
              <select value={action} onChange={(event) => setAction(event.target.value as typeof action)} style={inputStyle}>
                {["warn","timeout","kick","ban","unban"].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            {(action === "ban" || action === "timeout") && (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={labelStyle}>Срок</span>
                <input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="10m / 2h / 7d" style={inputStyle} />
                <span style={helpStyle}>Для ban пустое поле = навсегда.</span>
              </label>
            )}

            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Причина</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} />
            </label>

            <button type="button" disabled={busy || !targetId} onClick={() => void execute()} style={button("danger")}>
              {busy ? "Выполняем…" : "Применить"}
            </button>
          </div>
        </div>
        {target && <div style={{ marginTop: 10, color: "#6a7688", fontSize: 9 }}>Выбран: {target.displayName} · {target.id}</div>}
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>История кейсов</div>
        {!target && <div style={{ color: "#687486", fontSize: 10 }}>Выбери участника, чтобы увидеть историю.</div>}
        {target && !caseHistory.length && <div style={{ color: "#687486", fontSize: 10 }}>Кейсов нет.</div>}
        {caseHistory.map((item) => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "70px 110px 1fr 150px", gap: 8, padding: "9px 0", borderBottom: "1px solid #202733", fontSize: 9 }}>
            <span style={{ color: "#c8ced8" }}>#{item.id}</span>
            <span>{item.action}</span>
            <span style={{ color: "#667486" }}>{item.reason ?? "Без причины"}</span>
            <span style={{ color: "#596576" }}>{new Date(item.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function MusicPanel(props: {
  guildId: string;
  voiceChannels: Resource[];
  textChannels: Resource[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const [state, setState] = useState<MusicState | null>(null);
  const [query, setQuery] = useState("");
  const [voiceChannelId, setVoiceChannelId] = useState(props.voiceChannels[0]?.id ?? "");
  const [seek, setSeek] = useState("0");
  const [volume, setVolume] = useState("100");
  const [repeat, setRepeat] = useState("off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/music", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(String(body.error ?? "music_state_failed"));
    const next = body.state as MusicState;
    setState(next);
    setVolume(String(next.volume));
    setRepeat(next.repeatMode);
    if (next.voiceChannelId) setVoiceChannelId(next.voiceChannelId);
  }

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Music unavailable"));
    const id = window.setInterval(() => { void refresh().catch(() => undefined); }, 5000);
    return () => window.clearInterval(id);
  }, [props.guildId]);

  async function control(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...body })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error ?? "music_action_failed"));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Music action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={noticeStyle("error")}>{error}</div>}

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Настройки Music</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 180px 110px 110px", gap: 9 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Канал управления</span>
            <select value={String(props.values.preferredTextChannelId ?? "")} onChange={(event) => props.onChange("preferredTextChannelId", event.target.value || null)} style={inputStyle}>
              <option value="">Канал команды</option>
              {props.textChannels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Громкость по умолчанию</span>
            <input type="number" min={0} max={200} value={String(props.values.defaultVolume ?? 100)} onChange={(event) => props.onChange("defaultVolume", Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Автовыход, сек.</span>
            <input type="number" min={0} max={86400} value={String(props.values.autoLeaveSeconds ?? 30)} onChange={(event) => props.onChange("autoLeaveSeconds", Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 10px", border: "1px solid #303946", borderRadius: 9 }}>
            <span style={labelStyle}>Анонс трека</span>
            <input type="checkbox" checked={props.values.announceTrackStart !== false} onChange={(event) => props.onChange("announceTrackStart", event.target.checked)} />
          </label>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Autoplay / Radio profile</div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "180px 180px minmax(220px,1fr)", gap: 9, alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 42, padding: "0 10px", border: "1px solid #303946", borderRadius: 9 }}>
              <span style={labelStyle}>Autoplay</span>
              <input type="checkbox" checked={Boolean(props.values.autoplay)} onChange={(event) => props.onChange("autoplay", event.target.checked)} />
            </label>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 42, padding: "0 10px", border: "1px solid #303946", borderRadius: 9 }}>
              <span style={labelStyle}>Radio</span>
              <input type="checkbox" checked={Boolean(props.values.radioEnabled)} onChange={(event) => props.onChange("radioEnabled", event.target.checked)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Radio mode</span>
              <select value={String(props.values.radioMode ?? "artist")} onChange={(event) => props.onChange("radioMode", event.target.value)} style={inputStyle}>
                <option value="artist">Artist</option>
                <option value="genre">Genre</option>
                <option value="search">Search seed</option>
              </select>
            </label>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Radio seed</span>
            <input
              value={String(props.values.radioSeed ?? "")}
              onChange={(event) => props.onChange("radioSeed", event.target.value)}
              placeholder="Например: Daft Punk / liquid drum and bass / summer night drive"
              maxLength={200}
              style={inputStyle}
            />
            <span style={{ color: "#687486", fontSize: 9 }}>
              Для Artist можно оставить пустым: при запуске радио будет использован исполнитель текущего трека.
            </span>
          </label>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) 220px auto", gap: 9, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Песня / URL / playlist</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: Daft Punk — Get Lucky" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={labelStyle}>Voice-канал</span>
            <select value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} style={inputStyle}>
              <option value="">Выбери voice</option>
              {props.voiceChannels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !query.trim()} onClick={() => void control("play", { query, voiceChannelId })} style={button("primary")}>Play</button>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => void control("pause")} style={button("secondary")}>Pause</button>
          <button type="button" disabled={busy} onClick={() => void control("resume")} style={button("secondary")}>Resume</button>
          <button type="button" disabled={busy} onClick={() => void control("skip")} style={button("secondary")}>Skip</button>
          <button type="button" disabled={busy} onClick={() => void control("shuffle")} style={button("secondary")}>Shuffle</button>
          <button type="button" disabled={busy} onClick={() => void control("stop")} style={button("danger")}>Stop</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 9, marginTop: 12 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Repeat</span>
            <select value={repeat} onChange={(event) => { setRepeat(event.target.value); void control("repeat", { mode: event.target.value }); }} style={inputStyle}>
              <option value="off">Off</option><option value="track">Track</option><option value="queue">Queue</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Seek, sec</span>
            <input value={seek} onChange={(event) => setSeek(event.target.value)} onBlur={() => void control("seek", { value: Number(seek) })} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Volume</span>
            <input type="number" min={0} max={200} value={volume} onChange={(event) => setVolume(event.target.value)} onBlur={() => void control("volume", { value: Number(volume) })} style={inputStyle} />
          </label>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 18 }}>
        <div style={{ color: "#687486", fontSize: 9, letterSpacing: 1.1 }}>NOW PLAYING</div>
        <h2 style={{ margin: "7px 0 2px", fontSize: 19 }}>{state?.current?.title ?? "Ничего не играет"}</h2>
        <div style={{ color: "#6f7a8b", fontSize: 10 }}>{state?.current?.author ?? ""}</div>
        <div style={{ marginTop: 11, color: "#697588", fontSize: 9 }}>
          {state ? (state.paused ? "⏸ Пауза" : "▶ Играет") + " · " + state.repeatMode + " · volume " + state.volume + " · Lavalink " + state.nodeCount : "—"}
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Playlist / Queue</div>
        <div style={{ display: "grid", gap: 6 }}>
          {(state?.queue ?? []).map((track, index) => (
            <div key={index} style={{ display: "flex", gap: 9, padding: "8px 9px", background: "#0d1218", border: "1px solid #232b36", borderRadius: 8, fontSize: 10 }}>
              <span style={{ width: 22, color: "#5e6a7b" }}>{index + 1}</span>
              <span style={{ flex: 1 }}><strong>{track.title}</strong><span style={{ color: "#687486" }}> — {track.author}</span></span>
            </div>
          ))}
          {!state?.queue?.length && <div style={{ color: "#687486", fontSize: 10 }}>Очередь пуста.</div>}
        </div>
      </section>
    </div>
  );
}

function CustomCommandsPanel(props: { guildId: string; resources: { channels: Resource[]; roles: Resource[] } }) {
  const empty: CustomCommand = {
    id: 0,
    name: "",
    aliases: [],
    description: "",
    enabled: true,
    prefixEnabled: true,
    slashEnabled: true,
    actionType: "response",
    response: "",
    aliasTarget: null,
    allowedRoleIds: [],
    allowedChannelIds: [],
    cooldownSeconds: 0,
    roleId: null
  };
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [current, setCurrent] = useState<CustomCommand>(empty);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? "custom_commands_failed"));
      setCommands((body.commands ?? []) as CustomCommand[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить команды.")); }, [props.guildId]);

  async function save() {
    setError("");
    setNotice("");
    const payload = {
      name: current.name,
      aliases: current.aliases,
      description: current.description,
      enabled: current.enabled,
      prefixEnabled: current.prefixEnabled,
      slashEnabled: current.slashEnabled,
      actionType: current.actionType,
      response: current.response,
      aliasTarget: current.aliasTarget,
      allowedRoleIds: current.allowedRoleIds,
      allowedChannelIds: current.allowedChannelIds,
      cooldownSeconds: current.cooldownSeconds,
      roleId: current.roleId
    };
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands" + (current.id ? "/" + current.id : ""),
      {
        method: current.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "custom_command_save_failed"));
    await load();
    setCurrent(empty);
    setNotice("Команда сохранена.");
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить кастомную команду?")) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands/" + id, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "custom_command_delete_failed"));
    await load();
    if (current.id === id) setCurrent(empty);
  }

  const setList = (key: "allowedRoleIds" | "allowedChannelIds", values: string[]) =>
    setCurrent((previous) => ({ ...previous, [key]: values }));

  return (
    <div style={{ display: "grid", gap: 13 }}>
      {(error || notice) && <div>{error ? <div style={noticeStyle("error")}>{error}</div> : <div style={noticeStyle("success")}>{notice}</div>}</div>}

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) 220px", gap: 12 }}>
          <div style={{ display: "grid", gap: 9 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <FieldInput label="Команда" value={current.name} onChange={(value) => setCurrent((p) => ({ ...p, name: value }))} placeholder="level" />
              <FieldInput label="Aliases" value={current.aliases.join(", ")} onChange={(value) => setCurrent((p) => ({ ...p, aliases: value.split(",").map((x) => x.trim()).filter(Boolean) }))} placeholder="rank, xp" />
            </div>
            <FieldInput label="Описание" value={current.description} onChange={(value) => setCurrent((p) => ({ ...p, description: value }))} placeholder="Показывает уровень пользователя" />
            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Ответ</span>
              <textarea value={current.response} onChange={(event) => setCurrent((p) => ({ ...p, response: event.target.value }))} placeholder="Привет, {mention}! У тебя {args}" style={{ ...inputStyle, minHeight: 120, resize: "vertical" }} />
              <span style={helpStyle}>Переменные: {"{user}"} {"{mention}"} {"{server}"} {"{channel}"} {"{args}"}</span>
            </label>
          </div>

          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <Toggle label="Prefix-команда" checked={current.prefixEnabled} onChange={(value) => setCurrent((p) => ({ ...p, prefixEnabled: value }))} />
            <Toggle label="Slash-команда" checked={current.slashEnabled} onChange={(value) => setCurrent((p) => ({ ...p, slashEnabled: value }))} />
            <Toggle label="Включена" checked={current.enabled} onChange={(value) => setCurrent((p) => ({ ...p, enabled: value }))} />
            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Cooldown, сек.</span><input type="number" min={0} max={86400} value={current.cooldownSeconds} onChange={(event) => setCurrent((p) => ({ ...p, cooldownSeconds: Number(event.target.value) }))} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Действие</span>
              <select value={current.actionType} onChange={(event) => setCurrent((p) => ({ ...p, actionType: event.target.value as CustomCommand["actionType"] }))} style={inputStyle}>
                <option value="response">Ответить сообщением</option>
                <option value="alias">Alias встроенной команды</option>
                <option value="add_role">Выдать роль</option>
                <option value="remove_role">Снять роль</option>
                <option value="toggle_role">Переключить роль</option>
              </select>
            </label>
            {["add_role","remove_role","toggle_role"].includes(current.actionType) && (
              <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Роль действия</span>
                <select value={current.roleId ?? ""} onChange={(event) => setCurrent((p) => ({ ...p, roleId: event.target.value || null }))} style={inputStyle}>
                  <option value="">Выбери роль</option>
                  {props.resources.roles.filter((role) => role.manageable !== false).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            )}
            {current.actionType === "alias" && (
              <FieldInput label="Целевая команда" value={current.aliasTarget ?? ""} onChange={(value) => setCurrent((p) => ({ ...p, aliasTarget: value }))} placeholder="level / queue / ban" />
            )}

            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Разрешённые роли</span>
              <select multiple value={current.allowedRoleIds} onChange={(event) => setList("allowedRoleIds", [...event.target.selectedOptions].map((x) => x.value))} style={{ ...inputStyle, minHeight: 105 }}>
                {props.resources.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Разрешённые каналы</span>
              <select multiple value={current.allowedChannelIds} onChange={(event) => setList("allowedChannelIds", [...event.target.selectedOptions].map((x) => x.value))} style={{ ...inputStyle, minHeight: 105 }}>
                {props.resources.channels.filter((channel) => channel.type === 0).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>

            <button type="button" onClick={() => void save().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось сохранить."))} style={button("primary")}>Сохранить команду</button>
            <button type="button" onClick={() => setCurrent(empty)} style={button("secondary")}>Новая команда</button>
          </div>
        </div>
      </section>

      <section style={{ ...panelStyle, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Созданные команды {loading ? "…" : ""}</div>
        <div style={{ display: "grid", gap: 7 }}>
          {commands.map((command) => (
            <div key={command.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", background: "#0d1218", border: "1px solid #232b36", borderRadius: 9 }}>
              <span style={{ flex: 1 }}><strong style={{ fontSize: 11 }}>{command.name}</strong><span style={{ marginLeft: 8, color: "#657184", fontSize: 9 }}>{command.description}</span></span>
              <span style={{ color: "#657184", fontSize: 9 }}>{command.prefixEnabled ? "!" : ""}{command.slashEnabled ? " /" : ""}</span>
              <button type="button" onClick={() => setCurrent(command)} style={button("secondary")}>Изменить</button>
              <button type="button" onClick={() => void remove(command.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось удалить."))} style={button("danger")}>Удалить</button>
            </div>
          ))}
          {!commands.length && <div style={{ color: "#697587", fontSize: 10 }}>Кастомных команд пока нет.</div>}
        </div>
      </section>
    </div>
  );
}

function FieldInput(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>{props.label}</span><input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} style={inputStyle} /></label>;
}

function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, padding: "10px 11px", background: "#0d1218", border: "1px solid #232b36", borderRadius: 9, fontSize: 10 }}><span>{props.label}</span><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /></label>;
}

function AuditPage(props: { audit: AuditEvent[] }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h1 style={{ margin: 0, fontSize: 25 }}>Журнал действий</h1>
      <section style={{ ...panelStyle, padding: 14 }}>
        {props.audit.map((event, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "180px 1fr 180px", gap: 10, padding: "9px 2px", borderBottom: index === props.audit.length - 1 ? 0 : "1px solid #202733", fontSize: 10 }}>
            <span style={{ color: "#c5cbd4" }}>{event.action}</span>
            <span style={{ color: "#697587" }}>{event.target_id ?? "—"}</span>
            <span style={{ color: "#596576", textAlign: "right" }}>{new Date(event.created_at).toLocaleString()}</span>
          </div>
        ))}
        {!props.audit.length && <div style={{ color: "#697587", fontSize: 10 }}>Журнал пуст.</div>}
      </section>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return <div style={{ ...panelStyle, padding: 15 }}><div style={{ color: "#687486", fontSize: 9 }}>{props.label}</div><div style={{ marginTop: 7, fontSize: 20, fontWeight: 760 }}>{props.value}</div></div>;
}

function formatNumber(value?: number) {
  return typeof value === "number" ? value.toLocaleString("ru-RU") : "—";
}

function parseDuration(value: string): number | undefined {
  const match = value.toLowerCase().trim().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "w" ? 10080 : unit === "d" ? 1440 : unit === "h" ? 60 : 1;
  return Math.min(40320, amount * multiplier);
}

const labelStyle = { color: "#7b8798", fontSize: 9 } as const;
const helpStyle = { color: "#5f6b7b", fontSize: 9 } as const;

function button(kind: "primary" | "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "danger" ? "#63383d" : kind === "primary" ? "#4654a0" : "#303946"),
    background: kind === "danger" ? "#26171a" : kind === "primary" ? "#343f83" : "#151b23",
    color: "#f1f4f8",
    borderRadius: 9,
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 650
  } as const;
}

function navButton(active: boolean) {
  return {
    width: "100%",
    display: "flex",
    gap: 9,
    alignItems: "center",
    padding: "10px 9px",
    margin: "1px 0",
    borderRadius: 9,
    border: active ? "1px solid #2b3442" : "1px solid transparent",
    background: active ? "#171d26" : "transparent",
    color: active ? "#fff" : "#c8ced8",
    cursor: "pointer",
    textAlign: "left"
  } as const;
}

function noticeStyle(kind: "error" | "success") {
  return {
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid " + (kind === "error" ? "#573337" : "#2b4c37"),
    background: kind === "error" ? "#211518" : "#111c16",
    color: kind === "error" ? "#f0a3aa" : "#9bd9b0",
    fontSize: 10
  } as const;
}
