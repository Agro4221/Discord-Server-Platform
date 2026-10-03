"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RolePanelsEditor } from "./role-panels-editor";
import { BackupPanel } from "./backup-panel";
import { GiveawaysPanel } from "./giveaways-panel";
import { AnalyticsPanel } from "./analytics-panel";
import { AutomationPanel } from "./automation-panel";
import { FleetPanel } from "./fleet-panel";
import { NotificationsPanel } from "./notifications-panel";

type View = "overview" | "modules" | "module" | "system" | "audit";
type Guild = { id: string; name: string; icon: string | null; memberCount?: number; channelCount?: number; roleCount?: number };
type ModuleState = Record<string, boolean>;
type SettingType = "text" | "number" | "boolean" | "channel" | "role" | "textarea";
type Field = { key: string; label: string; type: SettingType; description?: string; min?: number; max?: number; step?: number };
type ModuleAction = { id: string; label: string; kind?: "safe" | "danger"; confirmation?: string };
type Schema = { key: string; title: string; fields: Field[]; actions?: ModuleAction[] };
type Resource = { id: string; name: string; type?: number; position?: number; manageable?: boolean };
type AuditEvent = { action: string; target_id: string | null; created_at: string };
type CatalogItem = { key: string; title: string; description: string };

const GROUPS = [
  { key: "overview", label: "Обзор", icon: "⌂" },
  { key: "moderation", label: "Модерация", icon: "◈" },
  { key: "server", label: "Настройка сервера", icon: "⚙" },
  { key: "community", label: "Сообщество", icon: "✦" },
  { key: "automation", label: "Автоматизация", icon: "↯" },
  { key: "integrations", label: "Интеграции", icon: "◌" },
  { key: "system", label: "Система", icon: "▣" }
] as const;

const MODULE_GROUP: Record<string, string> = {
  moderation: "moderation", automod: "moderation", security: "moderation",
  "temporary-voice": "server", welcome: "server", verification: "server", roles: "server", tickets: "server",
  leveling: "community", giveaways: "community", starboard: "community", economy: "community", reminders: "community",
  automation: "automation", notifications: "integrations", music: "integrations", analytics: "integrations"
};

const MODULE_META: Record<string, {
  icon: string; accent: string; title: string; summary: string; dashboard: "full" | "settings" | "discord";
}> = {
  moderation: { icon: "⚖", accent: "#f0a46b", title: "Модерация", summary: "Предупреждения, timeout, kick, ban и история действий", dashboard: "discord" },
  automod: { icon: "⌁", accent: "#f0c46b", title: "AutoMod", summary: "Спам, ссылки, упоминания, повторные сообщения и фильтры", dashboard: "settings" },
  security: { icon: "◉", accent: "#ef7777", title: "Security", summary: "Anti-Raid, lockdown и защита от разрушительных действий", dashboard: "settings" },
  "temporary-voice": { icon: "◌", accent: "#76b7f4", title: "Temporary Voice", summary: "Автоматические временные голосовые комнаты", dashboard: "settings" },
  welcome: { icon: "✧", accent: "#9ccf87", title: "Приветствие", summary: "Welcome, goodbye и сообщения новым участникам", dashboard: "settings" },
  verification: { icon: "✓", accent: "#70d4b5", title: "Верификация", summary: "Проверка участников и quarantine-поток", dashboard: "settings" },
  roles: { icon: "♢", accent: "#b294f6", title: "Роли", summary: "Role panels и самостоятельный выбор ролей", dashboard: "full" },
  leveling: { icon: "↗", accent: "#72c5f2", title: "Leveling", summary: "XP, уровни, ранги и лидерборды", dashboard: "settings" },
  tickets: { icon: "▤", accent: "#d3a4f0", title: "Тикеты", summary: "Поддержка, staff и transcript", dashboard: "settings" },
  giveaways: { icon: "🎁", accent: "#f09bc0", title: "Розыгрыши", summary: "Создание, завершение и повторный выбор победителей", dashboard: "full" },
  starboard: { icon: "★", accent: "#e5c76b", title: "Starboard", summary: "Популярные сообщения и лучшие моменты", dashboard: "settings" },
  economy: { icon: "◍", accent: "#7bd6a3", title: "Экономика", summary: "Баланс, daily и магазин ролей", dashboard: "discord" },
  reminders: { icon: "◷", accent: "#85b8dd", title: "Напоминания", summary: "Напоминания и utility-команды", dashboard: "discord" },
  notifications: { icon: "◬", accent: "#74c8dc", title: "Уведомления", summary: "RSS/feed источники в Discord", dashboard: "full" },
  automation: { icon: "↯", accent: "#9f8cf2", title: "Automation", summary: "Триггеры → условия → действия", dashboard: "full" },
  music: { icon: "♫", accent: "#8bb8f0", title: "Music", summary: "Lavalink, очередь и воспроизведение", dashboard: "settings" },
  analytics: { icon: "▥", accent: "#7cc9b8", title: "Analytics", summary: "Активность сервера и события", dashboard: "full" }
};

const DEFAULT_META = { icon: "•", accent: "#8a91a2", title: "Модуль", summary: "Модуль Discord Server Platform", dashboard: "discord" as const };
const panel = { background: "linear-gradient(180deg,#12151d 0%,#0f1218 100%)", border: "1px solid #242a36", borderRadius: 18, boxShadow: "0 14px 40px rgba(0,0,0,.16)" } as const;
const inputStyle = { background: "#0d1016", color: "#f4f5f7", border: "1px solid #303643", borderRadius: 11, padding: "11px 12px", outline: "none" } as const;
const selectStyle = { background: "#0d1016", color: "#f4f5f7", border: "1px solid #303643", borderRadius: 10, padding: "9px 10px", outline: "none" } as const;
const textButton = { border: 0, background: "transparent", color: "#8b98ad", fontSize: 11, cursor: "pointer", padding: 0 } as const;
const quickCardStyle = { display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: 13, background: "#10141c", border: "1px solid #232936", color: "#f2f4f7", cursor: "pointer", textAlign: "left" } as const;

export function DashboardClient() {
  const [view, setView] = useState<View>("overview");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modules, setModules] = useState<ModuleState>({});
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [resources, setResources] = useState<{ channels: Resource[]; roles: Resource[] }>({ channels: [], roles: [] });
  const [selectedModule, setSelectedModule] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<{ status: string; discord: string; database: string } | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [search, setSearch] = useState("");
  const [moduleGroup, setModuleGroup] = useState("all");

  const schema = useMemo(() => schemas.find((item) => item.key === selectedModule) ?? null, [schemas, selectedModule]);
  const selectedCatalog = useMemo(() => catalog.find((item) => item.key === selectedModule), [catalog, selectedModule]);
  const selectedGuild = guilds.find((guild) => guild.id === guildId);
  const enabledCount = catalog.filter((item) => modules[item.key]).length;

  useEffect(() => {
    void Promise.all([
      fetch("/api/guilds", { cache: "no-store" }).then(async (r) => r.json()),
      fetch("/api/module-schemas", { cache: "no-store" }).then(async (r) => r.json()),
      fetch("/api/health", { cache: "no-store" }).then(async (r) => r.json()).catch(() => null)
    ]).then(([guildResponse, schemaResponse, healthResponse]) => {
      const nextGuilds = (guildResponse.guilds ?? []) as Guild[];
      setGuilds(nextGuilds);
      setGuildId((current) => current || nextGuilds[0]?.id || "");
      setSchemas((schemaResponse.schemas ?? []) as Schema[]);
      setHealth(healthResponse);
    }).catch(() => setError("Не удалось загрузить данные Control Center."));
  }, []);

  useEffect(() => {
    if (!guildId) return;
    let cancelled = false;

    async function getJson(path: string, label: string): Promise<Record<string, unknown>> {
      const response = await fetch(path, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? label));
      return body as Record<string, unknown>;
    }

    async function loadGuildData() {
      let moduleResponse: Record<string, unknown> | undefined;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          moduleResponse = await getJson("/api/guilds/" + encodeURIComponent(guildId) + "/modules", "modules_failed");
          break;
        } catch (reason) {
          const code = reason instanceof Error ? reason.message : "modules_failed";
          if (attempt < 6 && code === "guild_not_found") {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          throw reason;
        }
      }

      const [resourceResponse, auditResponse] = await Promise.all([
        getJson("/api/guilds/" + encodeURIComponent(guildId) + "/resources", "resources_failed"),
        getJson("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=40", "audit_failed")
      ]);

      if (cancelled) return;
      const nextCatalog = (moduleResponse?.catalog ?? []) as CatalogItem[];
      setCatalog(nextCatalog);
      setModules((moduleResponse?.modules ?? {}) as ModuleState);
      setResources({
        channels: (resourceResponse.channels ?? []) as Resource[],
        roles: (resourceResponse.roles ?? []) as Resource[]
      });
      setAudit((auditResponse.events ?? []) as AuditEvent[]);
      setSelectedModule((current) => current || nextCatalog[0]?.key || "");
    }

    void loadGuildData().catch((reason) => {
      if (cancelled) return;
      const code = reason instanceof Error ? reason.message : "unknown_error";
      setError(({
        guild_not_found: "Бот ещё синхронизирует сервер. Обновите страницу через несколько секунд.",
        resources_failed: "Не удалось получить каналы и роли сервера.",
        audit_failed: "Не удалось получить журнал действий.",
        modules_failed: "Не удалось получить список модулей."
      } as Record<string, string>)[code] ?? "Не удалось загрузить данные выбранного сервера.");
    });

    return () => { cancelled = true; };
  }, [guildId]);

  useEffect(() => {
    if (!guildId || !selectedModule || !schema) return;
    setLoadingSettings(true);

    void fetch("/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "settings_failed");
        return body;
      })
      .then((body) => {
        const next = normalizeValues(schema, body.values ?? {});
        setValues(next);
        setOriginalValues(next);
      })
      .catch(() => setError("Не удалось загрузить настройки модуля."))
      .finally(() => setLoadingSettings(false));
  }, [guildId, selectedModule, schema]);

  function openModule(key: string) {
    setSelectedModule(key);
    setModuleGroup(MODULE_GROUP[key] ?? "all");
    setView("module");
    setSearch("");
    setError("");
    setActionMessage("");
  }

  async function reloadAudit() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=40", { cache: "no-store" });
    if (!response.ok) return;
    setAudit((await response.json()).events ?? []);
  }

  async function toggle(moduleKey: string, enabled: boolean) {
    if (!guildId) return;
    setSaving(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleKey, enabled })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "toggle_failed");
      setModules((previous) => ({ ...previous, [moduleKey]: enabled }));
      setSavedAt(new Date().toLocaleTimeString("ru-RU"));
      setActionMessage((MODULE_META[moduleKey] ?? DEFAULT_META).title + (enabled ? " включён." : " выключен."));
      await reloadAudit();
    } catch {
      setError("Не удалось изменить состояние модуля.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: ModuleAction) {
    if (!guildId || !selectedModule) return;
    if (action.kind === "danger" && !window.confirm(action.confirmation ?? "Подтвердить действие?")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/actions/" + encodeURIComponent(selectedModule) + "/" + encodeURIComponent(action.id), { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "action_failed");
      setActionMessage(action.label + " — выполнено.");
      await reloadAudit();
    } catch {
      setError("Не удалось выполнить действие.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!guildId || !selectedModule || !schema) return;
    setSaving(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "save_failed");
      const next = normalizeValues(schema, body.values ?? values);
      setValues(next);
      setOriginalValues(next);
      setSavedAt(new Date().toLocaleTimeString("ru-RU"));
      setActionMessage("Настройки сохранены.");
      await reloadAudit();
    } catch {
      setError("Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  async function exportConfig() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/export", { cache: "no-store" });
    if (!response.ok) return setError("Не удалось экспортировать конфигурацию.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "discord-server-platform-" + guildId + ".json";
    link.click();
    URL.revokeObjectURL(url);
    setActionMessage("Конфигурация экспортирована.");
  }

  async function importConfig(file: File) {
    if (!guildId) return;
    try {
      const payload = JSON.parse(await file.text());
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("import_failed");
      setActionMessage("Конфигурация импортирована.");
      await reloadAudit();
    } catch {
      setError("Файл конфигурации некорректен или импорт не удался.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const filteredCatalog = catalog.filter((item) => {
    if (moduleGroup !== "all" && MODULE_GROUP[item.key] !== moduleGroup) return false;
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return true;
    const meta = MODULE_META[item.key] ?? DEFAULT_META;
    return [meta.title, item.title, item.description, meta.summary].join(" ").toLocaleLowerCase().includes(needle);
  });

  const navigation = (
    <aside style={{
      width: 250, flex: "0 0 250px", background: "#0e1117", border: "1px solid #202630",
      borderRadius: 18, padding: 12, height: "fit-content", position: "sticky", top: 16
    }}>
      <div style={{ padding: "8px 10px 16px", borderBottom: "1px solid #202530", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.7, color: "#657082" }}>DISCORD SERVER PLATFORM</div>
        <div style={{ fontSize: 18, fontWeight: 780, marginTop: 4 }}>Admin Center</div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {GROUPS.map((item) => {
          const active = item.key === "overview" ? view === "overview"
            : item.key === "system" ? view === "system" || view === "audit"
            : view === "module" && MODULE_GROUP[selectedModule] === item.key;
          return (
            <button key={item.key} type="button" onClick={() => {
              if (item.key === "overview") setView("overview");
              else if (item.key === "system") setView("system");
              else {
                setModuleGroup(item.key);
                setSearch("");
                setView("modules");
              }
            }} style={{
              display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
              padding: "10px 11px", borderRadius: 11, border: active ? "1px solid #303746" : "1px solid transparent",
              background: active ? "#181c25" : "transparent", color: "#fff", cursor: "pointer"
            }}>
              <span style={{ width: 20, textAlign: "center", opacity: active ? .95 : .55 }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 650 : 520 }}>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 16, paddingTop: 15, borderTop: "1px solid #202530" }}>
        <div style={{ padding: "0 10px 8px", fontSize: 10, color: "#566173", letterSpacing: 1.2 }}>БЫСТРЫЙ ДОСТУП</div>
        {catalog.slice(0, 8).map((item) => {
          const meta = MODULE_META[item.key] ?? DEFAULT_META;
          return <button key={item.key} type="button" onClick={() => openModule(item.key)} style={{
            display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "7px 10px",
            border: 0, background: "transparent", color: "#dce1ea", cursor: "pointer", textAlign: "left"
          }}>
            <span style={{ color: meta.accent, width: 18, textAlign: "center" }}>{meta.icon}</span>
            <span style={{ flex: 1, fontSize: 12 }}>{meta.title}</span>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: modules[item.key] ? "#68d38b" : "#4b5361" }} />
          </button>;
        })}
        <button type="button" onClick={() => setView("modules")} style={{ border: 0, background: "transparent", color: "#8994a5", fontSize: 11, padding: "8px 10px", cursor: "pointer" }}>
          Все модули →
        </button>
      </div>
    </aside>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#090b0f", color: "#f3f5f8", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "18px 20px 50px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ ...panel, display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", minWidth: 250 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "#1a2030", color: "#9caeff", fontWeight: 800 }}>
              {selectedGuild?.name?.slice(0, 1).toUpperCase() || "D"}
            </div>
            <select value={guildId} onChange={(event) => setGuildId(event.target.value)} style={{ ...selectStyle, border: 0, padding: 4, background: "transparent", flex: 1 }}>
              {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 250, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: 10, color: "#5c6778" }}>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => search && setView("modules")} placeholder="Поиск модулей и настроек…" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: 35 }} />
          </div>

          <StatusPill health={health} />
          <button type="button" onClick={() => void exportConfig()} style={buttonStyle("secondary")}>Экспорт</button>
          <label style={{ ...buttonStyle("secondary"), cursor: "pointer" }}>
            Импорт
            <input type="file" accept=".json,application/json" hidden onChange={(event) => {
              const file = event.target.files?.[0]; if (file) void importConfig(file); event.currentTarget.value = "";
            }} />
          </label>
          <button type="button" onClick={() => void logout()} style={buttonStyle("secondary")}>Выйти</button>
        </div>

        {actionMessage && <Notice tone="success" message={actionMessage} />}
        {error && <Notice tone="error" message={error} />}

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ display: "block" }}>{navigation}</div>

          <section style={{ flex: 1, minWidth: 0 }}>
            {view === "overview" && <Overview guild={selectedGuild} catalog={catalog} modules={modules} health={health} audit={audit} enabledCount={enabledCount} onOpenModules={() => setView("modules")} onOpenModule={openModule} onSystem={() => setView("system")} onAudit={() => setView("audit")} onToggle={toggle} saving={saving} />}
            {view === "modules" && <ModuleLibrary catalog={filteredCatalog} modules={modules} selectedModule={selectedModule} groupKey={moduleGroup} search={search} onOpenModule={openModule} onToggle={toggle} saving={saving} />}
            {view === "module" && selectedModule && <ModulePage guildId={guildId} module={selectedCatalog} schema={schema} meta={MODULE_META[selectedModule] ?? DEFAULT_META} enabled={Boolean(modules[selectedModule])} loading={loadingSettings} values={values} originalValues={originalValues} resources={resources} saving={saving} savedAt={savedAt} onBack={() => setView("modules")} onToggle={(value) => void toggle(selectedModule, value)} onSave={() => void saveSettings()} onReset={() => setValues(originalValues)} onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))} onAction={(action) => void runAction(action)} audit={audit} onAudit={reloadAudit} />}
            {view === "system" && <SystemPage guildId={guildId} health={health} audit={audit} onAudit={() => setView("audit")} />}
            {view === "audit" && <AuditPage audit={audit} />}
          </section>
        </div>
      </div>
    </main>
  );
}

function Overview(props: {
  guild?: Guild; catalog: CatalogItem[]; modules: ModuleState; health: { status: string; discord: string; database: string } | null;
  audit: AuditEvent[]; enabledCount: number; onOpenModules: () => void; onOpenModule: (key: string) => void; onSystem: () => void;
  onAudit: () => void; onToggle: (key: string, value: boolean) => void; saving: boolean;
}) {
  const ready = props.health?.status === "ready";
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={{ ...panel, padding: 26, background: "radial-gradient(circle at 78% 15%,rgba(88,101,242,.15),transparent 35%),linear-gradient(135deg,#121827,#0e131c)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#687487", fontSize: 10, letterSpacing: 1.5 }}>SERVER OVERVIEW</div>
            <h1 style={{ margin: "8px 0", fontSize: 34, letterSpacing: -1.1 }}>{props.guild?.name ?? "Discord Server"}</h1>
            <p style={{ margin: 0, maxWidth: 720, color: "#99a3b2", lineHeight: 1.55 }}>
              Управляй сервером из одной панели: модерация, безопасность, роли, сообщество, автоматизация, музыка и аналитика.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={props.onOpenModules} style={buttonStyle("primary")}>Все модули</button>
            <button type="button" onClick={props.onSystem} style={buttonStyle("secondary")}>Система</button>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
        <StatCard label="Участники" value={formatNumber(props.guild?.memberCount)} hint="в выбранном сервере" />
        <StatCard label="Модули" value={String(props.enabledCount)} hint={"активно из " + props.catalog.length} />
        <StatCard label="Каналы" value={formatNumber(props.guild?.channelCount)} hint="текстовые + голосовые" />
        <StatCard label="Статус" value={ready ? "Online" : "Degraded"} hint={props.health?.database === "ready" ? "Core и база готовы" : "нужна проверка"} />
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(300px,.8fr)", gap: 16 }}>
        <div style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Основные возможности" eyebrow="FEATURES" action={<button type="button" onClick={props.onOpenModules} style={textButton}>Открыть всё →</button>} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
            {props.catalog.slice(0, 9).map((item) => <ModuleCard key={item.key} item={item} enabled={Boolean(props.modules[item.key])} onOpen={() => props.onOpenModule(item.key)} onToggle={(value) => props.onToggle(item.key, value)} compact saving={props.saving} />)}
          </div>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Состояние" eyebrow="HEALTH" />
            <HealthRow label="Discord Gateway" value={props.health?.discord ?? "unknown"} />
            <HealthRow label="PostgreSQL" value={props.health?.database ?? "unknown"} />
            <HealthRow label="Control Center" value={ready ? "ready" : "degraded"} />
          </div>
          <div style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Последние действия" eyebrow="AUDIT" action={<button type="button" onClick={props.onAudit} style={textButton}>Весь журнал →</button>} />
            {props.audit.slice(0, 4).map((event, index) => <AuditCompact key={index} event={event} last={index === Math.min(3, props.audit.length - 1)} />)}
            {!props.audit.length && <Empty text="Изменений ещё не было." />}
          </div>
        </div>
      </section>

      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Быстрый доступ" eyebrow="QUICK ACTIONS" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
          {props.catalog.slice(0, 4).map((item) => {
            const meta = MODULE_META[item.key] ?? DEFAULT_META;
            return <button key={item.key} type="button" onClick={() => props.onOpenModule(item.key)} style={quickCardStyle}>
              <span style={{ color: meta.accent, fontSize: 20 }}>{meta.icon}</span>
              <span style={{ flex: 1 }}><strong style={{ display: "block", fontSize: 13 }}>{meta.title}</strong><span style={{ display: "block", marginTop: 3, color: "#727d8d", fontSize: 10 }}>{meta.summary}</span></span>
              <span style={{ color: "#677182" }}>→</span>
            </button>;
          })}
        </div>
      </section>
    </div>
  );
}

function ModuleLibrary(props: {
  catalog: CatalogItem[]; modules: ModuleState; selectedModule: string; groupKey: string; search: string;
  onOpenModule: (key: string) => void; onToggle: (key: string, value: boolean) => void; saving: boolean;
}) {
  const groups = props.groupKey === "all" ? GROUPS.filter((group) => group.key !== "overview" && group.key !== "system") : GROUPS.filter((group) => group.key === props.groupKey);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageHeader
        eyebrow="FEATURES"
        title={GROUPS.find((item) => item.key === props.groupKey)?.label ?? "Все возможности"}
        description="Все модули в одном месте — без необходимости вспоминать команды Discord."
        right={<span style={{ color: "#748092", fontSize: 12 }}>{props.catalog.length} модулей</span>}
      />
      {groups.map((group) => {
        const items = props.catalog.filter((item) => MODULE_GROUP[item.key] === group.key);
        if (!items.length) return null;
        return <section key={group.key}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}><span style={{ color: "#8490a3" }}>{group.icon}</span><h2 style={{ margin: 0, fontSize: 18 }}>{group.label}</h2><span style={{ color: "#5f6979", fontSize: 11 }}>{items.length}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
            {items.map((item) => <ModuleCard key={item.key} item={item} enabled={Boolean(props.modules[item.key])} selected={props.selectedModule === item.key} onOpen={() => props.onOpenModule(item.key)} onToggle={(value) => props.onToggle(item.key, value)} saving={props.saving} />)}
          </div>
        </section>;
      })}
      {!props.catalog.length && <Empty text={props.search ? "Ничего не найдено." : "Модули ещё не загрузились."} />}
    </div>
  );
}

function ModulePage(props: {
  guildId: string; module?: CatalogItem; schema: Schema | null; meta: typeof DEFAULT_META | { icon: string; accent: string; title: string; summary: string; dashboard: "full" | "settings" | "discord" };
  enabled: boolean; loading: boolean; values: Record<string, unknown>; originalValues: Record<string, unknown>;
  resources: { channels: Resource[]; roles: Resource[] }; saving: boolean; savedAt: string; onBack: () => void; onToggle: (value: boolean) => void;
  onSave: () => void; onReset: () => void; onChange: (key: string, value: unknown) => void; onAction: (action: ModuleAction) => void; audit: AuditEvent[]; onAudit: () => void;
}) {
  const changed = JSON.stringify(props.values) !== JSON.stringify(props.originalValues);
  const meta = props.meta;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PageHeader eyebrow={MODULE_GROUP[props.module?.key ?? ""]?.toUpperCase() ?? "MODULE"} title={meta.title} description={meta.summary} right={
        <div style={{ display: "flex", gap: 8 }}><button type="button" onClick={props.onBack} style={buttonStyle("secondary")}>← Все модули</button><button type="button" disabled={props.saving} onClick={() => props.onToggle(!props.enabled)} style={buttonStyle(props.enabled ? "danger" : "primary")}>{props.enabled ? "Выключить" : "Включить"}</button></div>
      } />
      <section style={{ ...panel, padding: 17, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center", background: meta.accent + "15", color: meta.accent, fontSize: 23 }}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 220 }}><strong style={{ fontSize: 13 }}>{props.enabled ? "Модуль активен" : "Модуль выключен"}</strong><div style={{ marginTop: 4, color: "#778292", fontSize: 11 }}>{props.schema ? "Настройки применяются через Core API." : meta.dashboard === "discord" ? "Операционная часть пока управляется через Discord." : "Для модуля используется отдельный operational UI."}</div></div>
        <StatusTag active={props.enabled} />
      </section>

      {props.module?.key === "roles" && <section style={{ ...panel, padding: 20 }}><RolePanelsEditor guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} roles={props.resources.roles} onChanged={props.onAudit} /></section>}
      {props.module?.key === "giveaways" && <section style={{ ...panel, padding: 20 }}><GiveawaysPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} onChanged={props.onAudit} /></section>}
      {props.module?.key === "analytics" && <section style={{ ...panel, padding: 20 }}><AnalyticsPanel guildId={props.guildId} /></section>}
      {props.module?.key === "automation" && <section style={{ ...panel, padding: 20 }}><AutomationPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} roles={props.resources.roles.filter((item) => item.manageable !== false)} onChanged={props.onAudit} /></section>}
      {props.module?.key === "notifications" && <section style={{ ...panel, padding: 20 }}><NotificationsPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} onChanged={props.onAudit} /></section>}

      {!["roles", "giveaways", "analytics", "automation", "notifications"].includes(props.module?.key ?? "") && props.schema && (
        <section style={{ ...panel, padding: 20 }}>
          <div style={{ display: "grid", gap: 12 }}>
            {props.loading ? <Loading text="Загружаем настройки…" /> : props.schema.fields.map((field) => <SettingControl key={field.key} field={field} value={props.values[field.key]} resources={props.resources} onChange={(value) => props.onChange(field.key, value)} />)}
          </div>
          {props.schema.actions?.length ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20, paddingTop: 18, borderTop: "1px solid #202531" }}>{props.schema.actions.map((action) => <button key={action.id} type="button" disabled={props.saving} onClick={() => props.onAction(action)} style={buttonStyle(action.kind === "danger" ? "danger" : "secondary")}>{action.label}</button>)}</div> : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 22, paddingTop: 18, borderTop: "1px solid #202531" }}>
            <button type="button" disabled={!changed || props.saving || props.loading} onClick={props.onSave} style={buttonStyle(changed ? "primary" : "secondary")}>{props.saving ? "Сохраняем…" : "Сохранить изменения"}</button>
            <button type="button" disabled={!changed || props.saving} onClick={props.onReset} style={buttonStyle("secondary")}>Сбросить</button>
            {props.savedAt && <span style={{ color: "#6f7a89", fontSize: 11 }}>Сохранено {props.savedAt}</span>}
          </div>
        </section>
      )}

      {!props.schema && !["roles", "giveaways", "analytics", "automation", "notifications"].includes(props.module?.key ?? "") && (
        <section style={{ ...panel, padding: 24 }}>
          <div style={{ display: "flex", gap: 14 }}><div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "#181d26", color: meta.accent, fontSize: 20 }}>{meta.icon}</div><div><h3 style={{ margin: 0, fontSize: 18 }}>Операционная панель ещё не добавлена</h3><p style={{ margin: "7px 0 0", maxWidth: 760, color: "#7d8796", lineHeight: 1.55 }}>Модуль уже работает в Core/Discord, но отдельный web-интерфейс для этой функции пока отсутствует. Он будет добавлен сюда, а не спрятан в технические настройки.</p></div></div>
        </section>
      )}

      <section style={{ ...panel, padding: 20 }}><SectionHeader title="Недавняя активность" eyebrow="AUDIT" action={<button type="button" onClick={props.onAudit} style={textButton}>Открыть журнал →</button>} />{props.audit.slice(0, 6).map((event, index) => <AuditCompact key={index} event={event} last={index === Math.min(5, props.audit.length - 1)} />)}{!props.audit.length && <Empty text="Изменений ещё не было." />}</section>
    </div>
  );
}

function SystemPage({ guildId, health, audit, onAudit }: { guildId: string; health: { status: string; discord: string; database: string } | null; audit: AuditEvent[]; onAudit: () => void }) {
  return <div style={{ display: "grid", gap: 16 }}>
    <PageHeader eyebrow="SYSTEM" title="Система" description="Bot fleet, состояние Core, резервные копии и журнал действий." />
    <section style={{ ...panel, padding: 20 }}><SectionHeader title="Bot Fleet" eyebrow="IDENTITIES" /><FleetPanel guildId={guildId} onChanged={onAudit} /></section>
    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div style={{ ...panel, padding: 20 }}><SectionHeader title="Состояние" eyebrow="HEALTH" /><HealthRow label="Статус" value={health?.status ?? "unknown"} /><HealthRow label="Discord" value={health?.discord ?? "unknown"} /><HealthRow label="PostgreSQL" value={health?.database ?? "unknown"} /></div>
      <div style={{ ...panel, padding: 20 }}><SectionHeader title="Резервные копии" eyebrow="BACKUPS" /><BackupPanel guildId={guildId} onChanged={onAudit} /></div>
    </section>
    <section style={{ ...panel, padding: 20 }}><SectionHeader title="Последние изменения" eyebrow="AUDIT" action={<button type="button" onClick={onAudit} style={textButton}>Открыть полный журнал →</button>} />{audit.slice(0, 8).map((event, index) => <AuditCompact key={index} event={event} last={index === Math.min(7, audit.length - 1)} />)}{!audit.length && <Empty text="Журнал пуст." />}</section>
  </div>;
}

function AuditPage({ audit }: { audit: AuditEvent[] }) {
  return <div style={{ display: "grid", gap: 16 }}><PageHeader eyebrow="AUDIT LOG" title="Журнал действий" description="Изменения конфигурации и операции Dashboard/Core." /><section style={{ ...panel, padding: 20 }}>{audit.length ? audit.map((event, index) => <AuditCompact key={index} event={event} last={index === audit.length - 1} />) : <Empty text="Журнал пуст." />}</section></div>;
}

function ModuleCard({ item, enabled, selected, onOpen, onToggle, compact, saving }: { item: CatalogItem; enabled: boolean; selected?: boolean; onOpen: () => void; onToggle: (value: boolean) => void; compact?: boolean; saving: boolean }) {
  const meta = MODULE_META[item.key] ?? DEFAULT_META;
  return <div style={{ ...panel, padding: compact ? 13 : 16, borderColor: selected ? meta.accent + "70" : "#242a36", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: meta.accent, opacity: enabled ? .9 : .18 }} />
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: compact ? 34 : 42, height: compact ? 34 : 42, borderRadius: 12, display: "grid", placeItems: "center", background: meta.accent + "14", color: meta.accent, fontSize: compact ? 17 : 20, flexShrink: 0 }}>{meta.icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><strong style={{ fontSize: compact ? 13 : 15 }}>{meta.title}</strong><StatusDot active={enabled} /></div><div style={{ marginTop: 5, color: "#7d8797", fontSize: compact ? 10 : 11, lineHeight: 1.45 }}>{meta.summary}</div></div>
    </div>
    <div style={{ display: "flex", gap: 7, marginTop: 13 }}>
      <button type="button" onClick={onOpen} style={{ ...buttonStyle("secondary"), flex: 1, padding: "8px 10px", fontSize: 10 }}>Открыть</button>
      <button type="button" onClick={() => onToggle(!enabled)} disabled={saving} style={{ ...buttonStyle(enabled ? "danger" : "primary"), padding: "8px 10px", fontSize: 10 }}>{enabled ? "Вкл" : "Выкл"}</button>
    </div>
  </div>;
}

function SettingControl({ field, value, resources, onChange }: { field: Field; value: unknown; resources: { channels: Resource[]; roles: Resource[] }; onChange: (value: unknown) => void }) {
  const common = { ...inputStyle, width: "100%", boxSizing: "border-box" as const };
  return <div style={{ padding: 14, borderRadius: 14, background: "#0c1016", border: "1px solid #1e2530" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, alignItems: "baseline", flexWrap: "wrap" }}><label style={{ fontSize: 13, fontWeight: 700 }}>{field.label}</label>{field.description && <span style={{ color: "#687383", fontSize: 10 }}>{field.description}</span>}</div>
    {field.type === "boolean" && <button type="button" onClick={() => onChange(value !== true)} style={{ minWidth: 110, borderRadius: 999, padding: "9px 13px", border: value === true ? "1px solid #3d8e5f" : "1px solid #343945", background: value === true ? "#173523" : "#171a21", color: "#fff", cursor: "pointer" }}>{value === true ? "Включено" : "Выключено"}</button>}
    {field.type === "text" && <input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} style={common} />}
    {field.type === "number" && <input type="number" value={typeof value === "number" ? value : ""} min={field.min} max={field.max} step={field.step ?? 1} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} style={common} />}
    {field.type === "textarea" && <textarea value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""} onChange={(event) => onChange(field.key === "blockedWords" ? event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) : event.target.value)} rows={6} style={{ ...common, resize: "vertical", lineHeight: 1.5 }} />}
    {(field.type === "channel" || field.type === "role") && <select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || null)} style={common}><option value="">Не выбрано</option>{(field.type === "channel" ? resources.channels : resources.roles).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}{resource.type === 4 ? " · категория" : resource.manageable === false ? " · hierarchy" : ""}</option>)}</select>}
  </div>;
}

function PageHeader({ eyebrow, title, description, right }: { eyebrow: string; title: string; description: string; right?: ReactNode }) {
  return <section style={{ ...panel, padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}><div><div style={{ color: "#687487", fontSize: 10, letterSpacing: 1.5 }}>{eyebrow}</div><h1 style={{ margin: "7px 0", fontSize: 31, letterSpacing: -.8 }}>{title}</h1><p style={{ margin: 0, color: "#8791a0", lineHeight: 1.5, maxWidth: 780 }}>{description}</p></div>{right}</div></section>;
}
function SectionHeader({ title, eyebrow, action }: { title: string; eyebrow: string; action?: ReactNode }) { return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 }}><div><div style={{ color: "#5e6979", fontSize: 9, letterSpacing: 1.25 }}>{eyebrow}</div><h2 style={{ margin: "4px 0 0", fontSize: 17 }}>{title}</h2></div>{action}</div>; }
function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) { return <div style={{ ...panel, padding: 16 }}><div style={{ color: "#717c8d", fontSize: 10 }}>{label}</div><div style={{ marginTop: 7, fontSize: 27, fontWeight: 760 }}>{value}</div><div style={{ marginTop: 4, color: "#4f5969", fontSize: 9 }}>{hint}</div></div>; }
function HealthRow({ label, value }: { label: string; value: string }) { return <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #1e2430" }}><span style={{ color: "#8791a1", fontSize: 11 }}>{label}</span><span style={{ color: value === "ready" ? "#73d69a" : "#d4aa73", fontSize: 11 }}>{value}</span></div>; }
function AuditCompact({ event, last }: { event: AuditEvent; last: boolean }) { return <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: last ? "none" : "1px solid #1e2430" }}><div style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "#171c25", color: "#8b98aa", fontSize: 10 }}>↗</div><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.action}</div><div style={{ marginTop: 2, color: "#626d7d", fontSize: 9 }}>{event.target_id ?? "system"}</div></div><time style={{ color: "#5f6978", fontSize: 9 }}>{new Date(event.created_at).toLocaleString()}</time></div>; }
function StatusPill({ health }: { health: { status: string } | null }) { const ready = health?.status === "ready"; return <div style={{ padding: "8px 10px", borderRadius: 999, border: "1px solid " + (ready ? "#2e6847" : "#5d4c31"), background: ready ? "#12271a" : "#241d14", color: ready ? "#7bdc9d" : "#deb87d", fontSize: 10 }}>● {ready ? "Healthy" : "Degraded"}</div>; }
function StatusTag({ active }: { active: boolean }) { return <div style={{ padding: "7px 10px", borderRadius: 999, background: active ? "#13261a" : "#191d24", color: active ? "#7ed89b" : "#788292", fontSize: 10, border: "1px solid " + (active ? "#295a3e" : "#2b313c") }}>{active ? "ACTIVE" : "OFF"}</div>; }
function StatusDot({ active }: { active: boolean }) { return <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? "#68d48c" : "#4f5765", display: "inline-block" }} />; }
function Notice({ tone, message }: { tone: "success" | "error"; message: string }) { const good = tone === "success"; return <div style={{ marginBottom: 13, padding: "11px 13px", borderRadius: 12, background: good ? "#12271a" : "#32191b", border: "1px solid " + (good ? "#285638" : "#63292d"), color: good ? "#8cdaa6" : "#ffb1b1", fontSize: 11 }}>{message}</div>; }
function Empty({ text }: { text: string }) { return <div style={{ padding: "24px 4px", textAlign: "center", color: "#646e7d", fontSize: 11 }}>{text}</div>; }
function Loading({ text }: { text: string }) { return <div style={{ padding: "32px 0", textAlign: "center", color: "#657082", fontSize: 11 }}>{text}</div>; }
function formatNumber(value?: number) { return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ru-RU") : "—"; }
function normalizeValues(schema: Schema | null, values: Record<string, unknown>) {
  if (!schema) return values;
  const next = { ...values };
  for (const field of schema.fields) {
    if (field.type === "boolean" && typeof next[field.key] !== "boolean") next[field.key] = false;
    if (field.type === "number" && typeof next[field.key] !== "number") next[field.key] = field.min ?? 0;
    if (field.type === "textarea" && next[field.key] === undefined) next[field.key] = field.key === "blockedWords" ? [] : "";
    if ((field.type === "channel" || field.type === "role" || field.type === "text") && next[field.key] === undefined) next[field.key] = null;
  }
  return next;
}
function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171b23";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303746";
  return { border: "1px solid " + border, background, color: "#fff", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600 } as const;
}
