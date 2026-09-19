"use client";

import { useEffect, useMemo, useState } from "react";

type Guild = { id: string; name: string; icon: string | null };
type ModuleState = Record<string, boolean>;
type CatalogItem = { key: string; title: string; description: string };

export function DashboardClient() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modules, setModules] = useState<ModuleState>({});
  const [health, setHealth] = useState<{
    status: string;
    discord: string;
    database: string;
    modules: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    void Promise.all([
      fetch("/api/guilds", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
    ]).then(([guildResponse, healthResponse]) => {
      setGuilds(guildResponse.guilds ?? []);
      setGuildId(guildResponse.guilds?.[0]?.id ?? "");
      setHealth(healthResponse);
    }).catch(() => setError("Не удалось получить состояние платформы."));
  }, []);

  useEffect(() => {
    if (!guildId) return;
    setError("");
    void fetch(`/api/guilds/${encodeURIComponent(guildId)}/modules`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "request_failed");
        return body;
      })
      .then((body) => {
        setCatalog(body.catalog ?? []);
        setModules(body.modules ?? {});
      })
      .catch(() => setError("Не удалось загрузить модули сервера."));
  }, [guildId]);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === guildId),
    [guilds, guildId]
  );

  async function toggle(moduleKey: string, enabled: boolean) {
    if (!guildId) return;
    setSaving(moduleKey);
    setError("");

    try {
      const response = await fetch(`/api/guilds/${encodeURIComponent(guildId)}/modules`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleKey, enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "request_failed");
      setModules((previous) => ({ ...previous, [moduleKey]: enabled }));
    } catch {
      setError("Не удалось сохранить настройку.");
    } finally {
      setSaving("");
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0b0d12", color: "#f4f5f7", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "34px 24px 60px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end", marginBottom: 30 }}>
          <div>
            <div style={{ opacity: 0.52, fontSize: 12, letterSpacing: 1.8 }}>DISCORD SERVER PLATFORM</div>
            <h1 style={{ fontSize: 42, margin: "7px 0 8px", letterSpacing: -1.5 }}>Control Center</h1>
            <div style={{ opacity: 0.62 }}>Локальная админка. Настройки применяются к твоему self-hosted экземпляру.</div>
          </div>
          <div style={{ padding: "9px 13px", border: "1px solid #292e3a", borderRadius: 999, background: "#10131a" }}>
            ● {health?.status === "ready" ? "Platform healthy" : "Degraded / offline"}
          </div>
        </header>

        {error && (
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 12, background: "#32191b", border: "1px solid #63292d" }}>
            {error}
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 24 }}>
          {[
            ["Discord", health?.discord ?? "unknown"],
            ["Database", health?.database ?? "unknown"],
            ["Dashboard", "local"]
          ].map(([label, value]) => (
            <div key={label} style={{ background: "#11141b", border: "1px solid #242934", borderRadius: 16, padding: 18 }}>
              <div style={{ opacity: 0.5, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 22, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ background: "#11141b", border: "1px solid #242934", borderRadius: 18, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", marginBottom: 18 }}>
            <div>
              <div style={{ opacity: 0.5, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Server</div>
              <h2 style={{ margin: "6px 0 0", fontSize: 22 }}>{selectedGuild?.name ?? "No guild available"}</h2>
            </div>
            <select
              value={guildId}
              onChange={(event) => setGuildId(event.target.value)}
              style={{ background: "#0d1016", color: "#f4f5f7", border: "1px solid #2a2f3b", borderRadius: 10, padding: "10px 12px", minWidth: 240 }}
            >
              {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {catalog.map((module) => {
              const enabled = modules[module.key] ?? false;
              return (
                <div key={module.key} style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", padding: 16, borderRadius: 14, background: "#0d1016", border: "1px solid #202530" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{module.title}</div>
                    <div style={{ opacity: 0.53, fontSize: 13, marginTop: 4 }}>{module.description}</div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={enabled}
                    disabled={saving === module.key}
                    onClick={() => void toggle(module.key, !enabled)}
                    style={{
                      minWidth: 82,
                      borderRadius: 999,
                      padding: "8px 12px",
                      border: enabled ? "1px solid #3f8f63" : "1px solid #343945",
                      background: enabled ? "#173523" : "#171a21",
                      color: "#fff",
                      cursor: saving === module.key ? "wait" : "pointer"
                    }}
                  >
                    {saving === module.key ? "..." : enabled ? "ON" : "OFF"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
