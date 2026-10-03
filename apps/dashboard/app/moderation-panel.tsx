"use client";

import { useEffect, useState } from "react";

type Escalation = {
  warnCount: number;
  action: "timeout" | "ban";
  durationMinutes: number;
  reason: string;
  enabled: boolean;
};

export function ModerationPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [rules, setRules] = useState<Escalation[]>([]);
  const [warnCount, setWarnCount] = useState(3);
  const [action, setAction] = useState<Escalation["action"]>("timeout");
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("Automatic escalation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/escalations", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "escalations_failed");
    setRules((body.rules ?? []) as Escalation[]);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить правила эскалации."));
  }, [guildId]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/escalations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ warnCount, action, durationMinutes: minutes, reason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "escalation_save_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить правило.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(threshold: number) {
    if (!window.confirm("Удалить правило для " + threshold + " warn?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/escalations/" + threshold,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("escalation_remove_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить правило.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "120px 160px 120px minmax(0,1fr) auto", gap: 8 }}>
        <input type="number" min={1} max={100} value={warnCount} onChange={(e) => setWarnCount(Number(e.target.value))} style={inputStyle} />
        <select value={action} onChange={(e) => setAction(e.target.value as Escalation["action"])} style={inputStyle}>
          <option value="timeout">Timeout</option>
          <option value="ban">Ban</option>
        </select>
        <input type="number" min={action === "ban" ? 0 : 1} max={40320} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={inputStyle} placeholder="Мин." />
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={inputStyle} placeholder="Причина" />
        <button type="button" disabled={busy} onClick={() => void save()} style={buttonStyle}>{busy ? "…" : "Сохранить"}</button>
      </div>

      <div style={{ color: "#687486", fontSize: 10 }}>
        Timeout требует длительность. Для постоянного бана оставь 0 минут.
      </div>

      {rules.length ? rules.map((rule) => (
        <div key={rule.warnCount} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: "1px solid #202632" }}>
          <div>
            <strong style={{ fontSize: 12 }}>{rule.warnCount} warn → {rule.action === "timeout" ? "timeout " + rule.durationMinutes + " мин." : "ban" + (rule.durationMinutes ? " " + rule.durationMinutes + " мин." : " навсегда")}</strong>
            <div style={{ marginTop: 3, fontSize: 10, color: "#6e7888" }}>{rule.reason}</div>
          </div>
          <button type="button" disabled={busy} onClick={() => void remove(rule.warnCount)} style={buttonStyle}>Удалить</button>
        </div>
      )) : <div style={{ opacity: 0.42, fontSize: 11 }}>Правил эскалации пока нет.</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0d1118",
  color: "#f4f6fa",
  border: "1px solid #303846",
  borderRadius: 10,
  padding: "9px 10px"
} as const;

const buttonStyle = {
  border: "1px solid #303846",
  background: "#171c25",
  color: "#fff",
  borderRadius: 10,
  padding: "9px 12px",
  cursor: "pointer"
} as const;

const errorStyle = {
  padding: 10,
  borderRadius: 10,
  background: "#32191b",
  border: "1px solid #63292d"
} as const;
