"use client";

import { useEffect, useMemo, useState } from "react";
import { RolePanelsEditor } from "./role-panels-editor";
import { BackupPanel } from "./backup-panel";
import { GiveawaysPanel } from "./giveaways-panel";
import { AnalyticsPanel } from "./analytics-panel";
import { AutomationPanel } from "./automation-panel";
import { FleetPanel } from "./fleet-panel";

type Guild = { id: string; name: string; icon: string | null };
type ModuleState = Record<string, boolean>;
type SettingType = "text" | "number" | "boolean" | "channel" | "role" | "textarea";
type Field = {
  key: string;
  label: string;
  type: SettingType;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
};
type ModuleAction = { id: string; label: string; kind?: "safe" | "danger"; confirmation?: string };
type Schema = {
  key: string;
  title: string;
  fields: Field[];
  actions?: ModuleAction[];
};
type Resource = { id: string; name: string; type?: number; position?: number; manageable?: boolean };

const panelStyle = {
  background: "#11141b",
  border: "1px solid #242934",
  borderRadius: 18
} as const;

export function DashboardClient() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState("");
  const [catalog, setCatalog] = useState<{ key: string; title: string; description: string }[]>([]);
  const [modules, setModules] = useState<ModuleState>({});
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [resources, setResources] = useState<{ channels: Resource[]; roles: Resource[] }>({ channels: [], roles: [] });
  const [selectedModule, setSelectedModule] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<{ status: string; discord: string; database: string } | null>(null);
  const [audit, setAudit] = useState<{ action: string; target_id: string | null; created_at: string }[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const schema = useMemo(
    () => schemas.find((item) => item.key === selectedModule) ?? null,
    [schemas, selectedModule]
  );

  const selectedCatalog = useMemo(
    () => catalog.find((item) => item.key === selectedModule) ?? null,
    [catalog, selectedModule]
  );

  useEffect(() => {
    void Promise.all([
      fetch("/api/guilds", { cache: "no-store" }).then(async (r) => r.json()),
      fetch("/api/module-schemas", { cache: "no-store" }).then(async (r) => r.json()),
      fetch("/api/health", { cache: "no-store" }).then(async (r) => r.json()).catch(() => null)
    ])
      .then(([guildResponse, schemaResponse, healthResponse]) => {
        const nextGuilds = guildResponse.guilds ?? [];
        setGuilds(nextGuilds);
        setGuildId(nextGuilds[0]?.id ?? "");
        setSchemas(schemaResponse.schemas ?? []);
        setHealth(healthResponse);
      })
      .catch(() => setError("Не удалось загрузить Control Center."));
  }, []);

  useEffect(() => {
    if (!guildId) return;

    setError("");
    void Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/modules", { cache: "no-store" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "modules_failed");
        return body;
      }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/resources", { cache: "no-store" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "resources_failed");
        return body;
      }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=20", { cache: "no-store" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "audit_failed");
        return body;
      })
    ])
      .then(([moduleResponse, resourceResponse, auditResponse]) => {
        setCatalog(moduleResponse.catalog ?? []);
        setModules(moduleResponse.modules ?? {});
        setResources({
          channels: resourceResponse.channels ?? [],
          roles: resourceResponse.roles ?? []
        });
        setAudit(auditResponse.events ?? []);

        const firstConfigured = (moduleResponse.catalog ?? []).find((item: { key: string }) => item.key === selectedModule);
        if (!selectedModule || !firstConfigured) {
          setSelectedModule(moduleResponse.catalog?.[0]?.key ?? "");
        }
      })
      .catch(() => setError("Не удалось загрузить данные выбранного сервера."));
  }, [guildId]);

  useEffect(() => {
    if (!guildId || !selectedModule || !schema) return;

    setLoadingSettings(true);
    setError("");

    void fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule),
      { cache: "no-store" }
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "settings_failed");
        return body;
      })
      .then((body) => {
        const next = body.values ?? {};
        setValues(normalizeValues(schema, next));
        setOriginalValues(normalizeValues(schema, next));
      })
      .catch(() => setError("Не удалось загрузить настройки модуля."))
      .finally(() => setLoadingSettings(false));
  }, [guildId, selectedModule, schema]);

  async function toggle(moduleKey: string, enabled: boolean) {
    if (!guildId) return;
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleKey, enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "toggle_failed");
      setModules((previous) => ({ ...previous, [moduleKey]: enabled }));
      setSavedAt(new Date().toLocaleTimeString());
      reloadAudit();
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
    setError("");
    setActionMessage("");

    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/actions/" +
        encodeURIComponent(selectedModule) + "/" + encodeURIComponent(action.id),
        { method: "POST" }
      );
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
    if (!guildId || !selectedModule) return;
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values })
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "save_failed");
      const normalized = normalizeValues(schema, body.values ?? values);
      setValues(normalized);
      setOriginalValues(normalized);
      setSavedAt(new Date().toLocaleTimeString());
      await reloadAudit();
    } catch {
      setError("Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  async function reloadAudit() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=20", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    setAudit(body.events ?? []);
  }

  async function exportConfig() {
    if (!guildId) return;
    setActionMessage("");
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/export");
    if (!response.ok) {
      setError("Не удалось экспортировать конфигурацию.");
      return;
    }
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
    setActionMessage("");
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("import_failed");
      setActionMessage("Конфигурация импортирована. Перезагружаю настройки.");
      const settingsResponse = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule), { cache: "no-store" });
      if (settingsResponse.ok) {
        const body = await settingsResponse.json();
        setValues(normalizeValues(schema, body.values ?? {}));
        setOriginalValues(normalizeValues(schema, body.values ?? {}));
      }
      await reloadAudit();
    } catch {
      setError("Файл конфигурации некорректен или импорт не удался.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const changed = JSON.stringify(values) !== JSON.stringify(originalValues);

  return (
    <main style={{ minHeight: "100vh", background: "#0b0d12", color: "#f4f5f7", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "28px 22px 54px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 22 }}>
          <div>
            <div style={{ opacity: 0.48, fontSize: 12, letterSpacing: 1.8 }}>DISCORD SERVER PLATFORM</div>
            <h1 style={{ fontSize: 38, margin: "6px 0 6px", letterSpacing: -1.2 }}>Control Center</h1>
            <div style={{ opacity: 0.58, maxWidth: 720 }}>
              Настройки сервера хранятся в PostgreSQL и применяются через локальный Core API. Браузер не получает bot token или provider secrets.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ padding: "8px 12px", border: "1px solid #292e3a", borderRadius: 999, background: "#10131a", fontSize: 13 }}>
              ● {health?.status === "ready" ? "Healthy" : "Degraded"}
            </div>
            <button type="button" onClick={() => void exportConfig()} style={buttonStyle("secondary")}>Экспорт</button>
            <label style={{ ...buttonStyle("secondary"), display: "inline-flex", alignItems: "center" }}>
              Импорт
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importConfig(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void logout()}
              style={buttonStyle("secondary")}
            >
              Выйти
            </button>
          </div>
        </header>

        {actionMessage && <div style={{ marginBottom: 18, padding: 13, borderRadius: 12, background: "#12271b", border: "1px solid #274f36" }}>{actionMessage}</div>}

        {guildId && <FleetPanel guildId={guildId} onChanged={reloadAudit} />}

        {error && (
          <div style={{ marginBottom: 18, padding: 13, borderRadius: 12, background: "#32191b", border: "1px solid #63292d" }}>
            {error}
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          <aside style={{ ...panelStyle, padding: 12, position: "sticky", top: 16 }}>
            <div style={{ padding: "4px 8px 12px" }}>
              <div style={{ opacity: 0.5, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Server</div>
              <select
                value={guildId}
                onChange={(event) => setGuildId(event.target.value)}
                style={inputStyle}
              >
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>{guild.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              {catalog.map((item) => {
                const enabled = modules[item.key] ?? false;
                const active = item.key === selectedModule;
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => setSelectedModule(item.key)}
                    style={{
                      textAlign: "left",
                      width: "100%",
                      borderRadius: 10,
                      border: active ? "1px solid #3b4252" : "1px solid transparent",
                      background: active ? "#171b24" : "transparent",
                      color: "#fff",
                      padding: "10px 11px",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{item.title}</span>
                      <span style={{ fontSize: 10, opacity: enabled ? 0.95 : 0.32 }}>
                        {enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 11, opacity: 0.42 }}>{item.description}</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section style={{ display: "grid", gap: 16 }}>
            <div style={{ ...panelStyle, padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
                <div>
                  <div style={{ opacity: 0.48, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{selectedModule || "module"}</div>
                  <h2 style={{ fontSize: 28, margin: "6px 0 6px" }}>
                    {schema?.title ?? selectedCatalog?.title ?? "Выбери модуль"}
                  </h2>
                  <div style={{ opacity: 0.55 }}>{selectedCatalog?.description}</div>
                </div>

                {selectedModule && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void toggle(selectedModule, !(modules[selectedModule] ?? false))}
                    style={buttonStyle(modules[selectedModule] ? "danger" : "primary")}
                  >
                    {modules[selectedModule] ? "Выключить модуль" : "Включить модуль"}
                  </button>
                )}
              </div>
            </div>

            <div style={{ ...panelStyle, padding: 22 }}>
              {selectedModule === "roles" ? (

                <RolePanelsEditor
                  guildId={guildId}
                  channels={resources.channels.filter((resource) => resource.type === 0)}
                  roles={resources.roles}
                  onChanged={reloadAudit}
                />
              ) : selectedModule === "giveaways" ? (
                <GiveawaysPanel guildId={guildId} onChanged={reloadAudit} />
              ) : selectedModule === "analytics" ? (
                <AnalyticsPanel guildId={guildId} />
              ) : selectedModule === "automation" ? (
                <AutomationPanel
                  guildId={guildId}
                  channels={resources.channels.filter((resource) => resource.type === 0)}
                  onChanged={reloadAudit}
                />
              ) : !schema ? (
                <div style={{ opacity: 0.58, padding: "24px 0" }}>
                  Для этого модуля пока нет dashboard schema. Его operational UI будет добавлен отдельно.
                </div>
              ) : loadingSettings ? (
                <div style={{ opacity: 0.58, padding: "24px 0" }}>Загрузка настроек…</div>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 16 }}>
                    {schema.fields.map((field) => (
                      <SettingControl
                        key={field.key}
                        field={field}
                        value={values[field.key]}
                        resources={resources}
                        onChange={(next) => setValues((previous) => ({ ...previous, [field.key]: next }))}
                      />
                    ))}
                  </div>

                  {schema.actions?.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                      {schema.actions.map((action) => (
                        <button
                          type="button"
                          key={action.id}
                          disabled={saving}
                          onClick={() => void runAction(action)}
                          style={buttonStyle(action.kind === "danger" ? "danger" : "secondary")}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, paddingTop: 18, borderTop: "1px solid #202530" }}>
                    <button
                      type="button"
                      disabled={!changed || saving}
                      onClick={() => void saveSettings()}
                      style={buttonStyle(changed ? "primary" : "secondary")}
                    >
                      {saving ? "Сохранение…" : "Сохранить изменения"}
                    </button>
                    <button
                      type="button"
                      disabled={!changed || saving}
                      onClick={() => setValues(originalValues)}
                      style={buttonStyle("secondary")}
                    >
                      Сбросить
                    </button>
                    {savedAt && <span style={{ fontSize: 12, opacity: 0.42 }}>Сохранено в {savedAt}</span>}
                  </div>
                </>
              )}
            </div>

            <div style={{ ...panelStyle, padding: 22 }}>
              <BackupPanel guildId={guildId} onChanged={reloadAudit} />
            </div>

            <div style={{ ...panelStyle, padding: 22 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>Последние изменения</h3>
              <div style={{ marginTop: 12 }}>
                {audit.length === 0 ? (
                  <div style={{ opacity: 0.42, padding: "12px 0" }}>История пока пуста.</div>
                ) : audit.map((event, index) => (
                  <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "11px 0", borderBottom: index === audit.length - 1 ? "none" : "1px solid #1d212b" }}>
                    <div>
                      <div style={{ fontSize: 13 }}>{event.action}</div>
                      <div style={{ opacity: 0.38, fontSize: 11, marginTop: 2 }}>{event.target_id ?? "system"}</div>
                    </div>
                    <div style={{ opacity: 0.42, fontSize: 11 }}>{new Date(event.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function SettingControl({
  field,
  value,
  resources,
  onChange
}: {
  field: Field;
  value: unknown;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (value: unknown) => void;
}) {
  const common = { ...inputStyle, width: "100%", boxSizing: "border-box" as const };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 7 }}>
        <label style={{ fontSize: 13, fontWeight: 650 }}>{field.label}</label>
        {field.description && <span style={{ fontSize: 11, opacity: 0.38 }}>{field.description}</span>}
      </div>

      {field.type === "boolean" && (
        <button
          type="button"
          onClick={() => onChange(value !== true)}
          aria-pressed={value === true}
          style={{
            minWidth: 92,
            borderRadius: 999,
            padding: "9px 13px",
            border: value === true ? "1px solid #3f8f63" : "1px solid #343945",
            background: value === true ? "#173523" : "#171a21",
            color: "#fff",
            cursor: "pointer"
          }}
        >
          {value === true ? "Включено" : "Выключено"}
        </button>
      )}

      {(field.type === "text") && (
        <input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} style={common} />
      )}

      {(field.type === "number") && (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          style={common}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""}
          onChange={(event) => {
            if (field.key === "blockedWords") onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean));
            else onChange(event.target.value);
          }}
          rows={5}
          style={{ ...common, resize: "vertical" }}
        />
      )}

      {(field.type === "channel" || field.type === "role") && (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || null)}
          style={common}
        >
          <option value="">Не выбрано</option>
          {(field.type === "channel" ? resources.channels : resources.roles).map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}{resource.type === 4 ? " · category" : resource.manageable === false ? " · hierarchy" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

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

const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 10,
  padding: "11px 12px",
  outline: "none"
} as const;

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643";
  return {
    border: "1px solid " + border,
    background,
    color: "#fff",
    borderRadius: 10,
    padding: "10px 13px",
    cursor: "pointer"
  } as const;
}
