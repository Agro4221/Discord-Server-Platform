"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Escalation = {
  warnCount: number;
  action: "timeout" | "ban";
  durationMinutes: number;
  reason: string;
  enabled: boolean;
};

export function ModerationPanel({ guildId, channels, onChanged }: { guildId: string; channels: Resource[]; onChanged?: () => void | Promise<void> }) {
  const [rules, setRules] = useState<Escalation[]>([]);
  const [cleanupRules, setCleanupRules] = useState<Array<{ id: number; channelId: string; intervalSeconds: number; maxMessages: number; enabled: boolean; lastRunAt: string | null }>>([]);
  const [cleanupChannelId, setCleanupChannelId] = useState("");
  const [cleanupIntervalSeconds, setCleanupIntervalSeconds] = useState(3600);
  const [cleanupMaxMessages, setCleanupMaxMessages] = useState(100);
  const [warnCount, setWarnCount] = useState(3);
  const [action, setAction] = useState<Escalation["action"]>("timeout");
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("Automatic escalation");
  const [busy, setBusy] = useState(false);
  const [lockdown, setLockdown] = useState<{ active: boolean; lockedChannels: number }>({ active: false, lockedChannels: 0 });
  const [error, setError] = useState("");

  async function load() {
    const [response, cleanupResponse] = await Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/escalations", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/cleanup", { cache: "no-store" })
    ]);
    const body = await response.json().catch(() => ({}));
    const cleanupBody = await cleanupResponse.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "escalations_failed");
    if (!cleanupResponse.ok) throw new Error(cleanupBody.error ?? "cleanup_failed");
    setRules((body.rules ?? []) as Escalation[]);
    setCleanupRules(cleanupBody.rules ?? []);
    const lockdownResponse = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/lockdown", { cache: "no-store" });
    const lockdownBody = await lockdownResponse.json().catch(() => ({}));
    if (!lockdownResponse.ok) throw new Error(lockdownBody.error ?? "lockdown_failed");
    setLockdown({ active: Boolean(lockdownBody.active), lockedChannels: Number(lockdownBody.lockedChannels ?? 0) });
  }

  async function saveCleanup() {
    if (!cleanupChannelId) {
      setError("Выбери текстовый канал для autopurge.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId: cleanupChannelId,
          intervalSeconds: cleanupIntervalSeconds,
          maxMessages: cleanupMaxMessages,
          enabled: true
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "cleanup_save_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить autopurge.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCleanup(id: number) {
    if (!window.confirm("Удалить правило scheduled cleanup?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/cleanup/" + id, { method: "DELETE" });
      if (!response.ok) throw new Error("cleanup_remove_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить autopurge.");
    } finally {
      setBusy(false);
    }
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

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Incident Lockdown</div>
        <div style={{ color: "#687486", fontSize: 10 }}>
          Пресет <strong>all-text</strong>: блокирует отправку сообщений для @everyone во всех текстовых каналах и запоминает исходные значения для точного восстановления.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong style={{ fontSize: 11 }}>{lockdown.active ? "🔒 ACTIVE" : "✅ RELEASED"}</strong>
          <span style={{ fontSize: 10, color: "#687486" }}>каналов: {lockdown.lockedChannels}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true); setError("");
                try {
                  const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/lockdown", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ enabled: true })
                  });
                  const body = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(body.error ?? "lockdown_apply_failed");
                  await load();
                  await onChanged?.();
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Не удалось включить lockdown.");
                } finally {
                  setBusy(false);
                }
              }}
              style={buttonStyle}
            >
              🔒 Включить
            </button>
            <button
              type="button"
              disabled={busy || !lockdown.active}
              onClick={async () => {
                setBusy(true); setError("");
                try {
                  const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/lockdown", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ enabled: false })
                  });
                  const body = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(body.error ?? "lockdown_release_failed");
                  await load();
                  await onChanged?.();
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Не удалось снять lockdown.");
                } finally {
                  setBusy(false);
                }
              }}
              style={buttonStyle}
            >
              🔓 Снять
            </button>
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Scheduled cleanup / Auto-purge</div>
        <div style={{ color: "#687486", fontSize: 10 }}>
          Каждые заданное число секунд удаляет до N последних сообщений. Discord сам исключает слишком старые сообщения из bulk cleanup.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px 120px auto", gap: 8 }}>
          <select value={cleanupChannelId} onChange={(e) => setCleanupChannelId(e.target.value)} style={inputStyle}>
            <option value="">Текстовый канал</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
          <input type="number" min={60} max={604800} value={cleanupIntervalSeconds} onChange={(e) => setCleanupIntervalSeconds(Number(e.target.value))} style={inputStyle} />
          <input type="number" min={1} max={100} value={cleanupMaxMessages} onChange={(e) => setCleanupMaxMessages(Number(e.target.value))} style={inputStyle} />
          <button type="button" disabled={busy} onClick={() => void saveCleanup()} style={buttonStyle}>Сохранить</button>
        </div>
        <div style={{ color: "#687486", fontSize: 10 }}>Интервал: 60–604800 сек. · за проход: 1–100 сообщений.</div>
        {cleanupRules.length ? cleanupRules.map((rule) => (
          <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #202632" }}>
            <div>
              <strong style={{ fontSize: 11 }}>#{channels.find((channel) => channel.id === rule.channelId)?.name ?? rule.channelId}</strong>
              <div style={{ marginTop: 3, fontSize: 10, color: "#6e7888" }}>
                каждые {rule.intervalSeconds} сек. · до {rule.maxMessages} · {rule.enabled ? "ON" : "OFF"}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => void removeCleanup(rule.id)} style={buttonStyle}>Удалить</button>
          </div>
        )) : <div style={{ opacity: 0.42, fontSize: 11 }}>Правил scheduled cleanup пока нет.</div>}
      </section>

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
