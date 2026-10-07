"use client";

import { useEffect, useState } from "react";

type Incident = { id: number; eventType: string; expiresAt: string };
type Hierarchy = {
  botPresent: boolean;
  manageRoles: boolean;
  quarantineRoleConfigured: boolean;
  quarantineRoleManageable: boolean;
  logChannelConfigured: boolean;
  logChannelSendable: boolean;
};

export function SecurityPanel(props: {
  guildId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/security",
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "security_snapshot_failed"));
      setIncidents((body.incidents ?? []) as Incident[]);
      setHierarchy((body.hierarchy ?? null) as Hierarchy | null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить Security.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [props.guildId]);

  async function action(actionId: "check-hierarchy" | "clear-incidents") {
    if (actionId === "clear-incidents" && incidents.length > 0) {
      if (!window.confirm("Закрыть все активные Security-инциденты и выполнить восстановление quarantine?")) return;
    }

    setBusy(actionId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/actions/security/" + actionId,
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "security_action_failed"));
      if (actionId === "check-hierarchy") {
        setHierarchy((body.result ?? null) as Hierarchy | null);
        setNotice("Проверка hierarchy выполнена.");
      } else {
        setNotice("Активные инциденты обработаны.");
      }
      await load();
      await props.onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Security-операция не удалась.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {(error || notice) && (
        <div style={{
          padding: 9,
          borderRadius: 9,
          border: "1px solid " + (error ? "#63292d" : "#293a31"),
          background: error ? "#32191b" : "#112018",
          color: error ? "#ffb1b1" : "#9de0b7",
          fontSize: 10
        }}>
          {error || notice}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={Boolean(busy)} onClick={() => void action("check-hierarchy")} style={buttonStyle("secondary")}>
          {busy === "check-hierarchy" ? "Проверяем…" : "Проверить иерархию ролей"}
        </button>
        <button type="button" disabled={Boolean(busy) || incidents.length === 0} onClick={() => void action("clear-incidents")} style={buttonStyle("danger")}>
          {busy === "clear-incidents" ? "Обрабатываем…" : "Закрыть инциденты"}
        </button>
      </div>

      <section style={box}>
        <div style={eyebrow}>АКТИВНЫЕ ИНЦИДЕНТЫ</div>
        {loading ? <div style={muted}>Загружаем…</div> : incidents.length === 0 ? (
          <div style={muted}>Активных инцидентов нет.</div>
        ) : (
          <div style={{ display: "grid", gap: 7 }}>
            {incidents.map((incident) => (
              <div key={incident.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: 9, border: "1px solid #252d38", borderRadius: 9, background: "#0c1118" }}>
                <strong style={{ fontSize: 10 }}>{incident.eventType}</strong>
                <span style={pill}>#{incident.id}</span>
                <span style={{ marginLeft: "auto", color: "#738095", fontSize: 9 }}>
                  до {new Date(incident.expiresAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={box}>
        <div style={eyebrow}>ГОТОВНОСТЬ DISCORD</div>
        {loading ? <div style={muted}>Загружаем…</div> : hierarchy ? (
          <div style={{ display: "grid", gap: 7 }}>
            <CheckRow label="Бот присутствует" ok={hierarchy.botPresent} />
            <CheckRow label="Управление ролями" ok={hierarchy.manageRoles} />
            <CheckRow label="Роль карантина настроена" ok={hierarchy.quarantineRoleConfigured} />
            <CheckRow label="Бот может управлять ролью карантина" ok={hierarchy.quarantineRoleManageable} />
            <CheckRow label="Канал журнала безопасности настроен" ok={hierarchy.logChannelConfigured} />
            <CheckRow label="Боту доступен канал журнала безопасности" ok={hierarchy.logChannelSendable} />
          </div>
        ) : <div style={muted}>Диагностика ещё не выполнена.</div>}
      </section>
    </div>
  );
}

function CheckRow(props: { label: string; ok: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1d232d" }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: props.ok ? "#67d891" : "#d76e75" }} />
      <span style={{ color: "#aab3c0", fontSize: 10 }}>{props.label}</span>
      <span style={{ marginLeft: "auto", color: props.ok ? "#83cfa2" : "#cc7a80", fontSize: 9 }}>{props.ok ? "OK" : "CHECK"}</span>
    </div>
  );
}

function buttonStyle(kind: "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "danger" ? "#79343c" : "#303846"),
    background: kind === "danger" ? "#4b2227" : "#141922",
    color: "#fff",
    borderRadius: 9,
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 10
  } as const;
}

const box = { padding: 12, border: "1px solid #222a35", borderRadius: 12, background: "#0d1219" } as const;
const eyebrow = { color: "#566274", fontSize: 8, letterSpacing: 1.2 } as const;
const muted = { marginTop: 7, color: "#687486", fontSize: 10 } as const;
const pill = { padding: "3px 6px", borderRadius: 6, background: "#161c24", border: "1px solid #29313c", color: "#738095", fontSize: 8 } as const;
