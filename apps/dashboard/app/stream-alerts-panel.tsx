"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Platform = "twitch" | "youtube" | "vk";
type Alert = {
  id: number;
  platform: Platform;
  target: string;
  channelId: string;
  mentionRoleId: string | null;
  enabled: boolean;
  intervalSeconds: number;
  lastOnline: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export function StreamAlertsPanel({
  guildId,
  channels,
  roles,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [providers, setProviders] = useState<Record<Platform, boolean>>({ twitch: false, youtube: false, vk: true });
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [target, setTarget] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [mentionRoleId, setMentionRoleId] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [intervalDrafts, setIntervalDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "stream_alerts_failed");
    const nextAlerts: Alert[] = body.alerts ?? [];
    setAlerts(nextAlerts);
    setIntervalDrafts(Object.fromEntries(nextAlerts.map((alert) => [alert.id, String(alert.intervalSeconds)])));
    setProviders(body.providers ?? { twitch: false, youtube: false, vk: true });
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить уведомления."));
  }, [guildId]);

  useEffect(() => {
    setChannelId((current) => current && channels.some((channel) => channel.id === current)
      ? current
      : (channels[0]?.id ?? ""));
  }, [channels]);

  async function create() {
    if (!target.trim() || !channelId) {
      setError("Укажи источник и Discord-канал.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform,
          target: target.trim(),
          channelId,
          mentionRoleId: mentionRoleId || null,
          intervalSeconds
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_create_failed");
      setTarget("");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать уведомление.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(alert: Alert, patchData: Partial<Pick<Alert, "channelId" | "mentionRoleId" | "intervalSeconds" | "enabled">>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchData)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_update_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить уведомление.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow(alert: Alert) {
    setBusy(true);
    setCheckingId(alert.id);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_check_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить уведомление.");
    } finally {
      setCheckingId(null);
      setBusy(false);
    }
  }

  async function commitInterval(alert: Alert) {
    const raw = intervalDrafts[alert.id] ?? String(alert.intervalSeconds);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setIntervalDrafts((current) => ({ ...current, [alert.id]: String(alert.intervalSeconds) }));
      return;
    }
    const next = Math.min(Math.max(Math.trunc(parsed), 15), 3600);
    setIntervalDrafts((current) => ({ ...current, [alert.id]: String(next) }));
    if (next !== alert.intervalSeconds) {
      await patch(alert, { intervalSeconds: next });
    }
  }

  async function remove(alert: Alert) {
    if (!window.confirm("Удалить это уведомление?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_delete_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить уведомление.");
    } finally {
      setBusy(false);
    }
  }

  const hint = platform === "twitch"
    ? "логин Twitch"
    : platform === "youtube"
      ? "ID канала или @handle YouTube"
      : "slug канала VK Видео Live";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.55 }}>
        Для каждой подписки можно выбрать отдельный Discord-канал и роль для упоминания. Twitch использует API-учётные данные. YouTube и VK проверяются локально через yt-dlp; YouTube API key не нужен.
      </div>
      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)} style={inputStyle}>
          <option value="twitch">Twitch</option>
          <option value="youtube">YouTube</option>
          <option value="vk">VK Live</option>
        </select>
        <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={hint} style={inputStyle} />
        <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
          <option value="">Discord-канал</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <select value={mentionRoleId} onChange={(event) => setMentionRoleId(event.target.value)} style={inputStyle}>
          <option value="">Без mention</option>
          {roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
        </select>
        <input type="number" min={15} max={3600} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} style={inputStyle} aria-label="Интервал проверки в секундах" />
        <button type="button" disabled={busy || !providers[platform]} onClick={() => void create()} style={button("primary")}>
          {providers[platform] ? "Добавить" : "Провайдер не настроен"}
        </button>
      </div>

      {alerts.map((alert) => (
        <div key={alert.id} style={{ display: "grid", gridTemplateColumns: "minmax(110px, .7fr) minmax(180px, 1.4fr) repeat(3, minmax(130px, 1fr)) minmax(230px, auto)", gap: 8, alignItems: "center", padding: "12px 0", borderBottom: "1px solid #1d212b" }}>
          <strong>{alert.platform === "twitch" ? "Twitch" : alert.platform === "youtube" ? "YouTube" : "VK Live"}</strong>
          <div>
            <div style={{ fontWeight: 600 }}>{alert.target}</div>
            <div style={{ fontSize: 11, opacity: 0.45 }}>
              {alert.lastOnline ? "🟢 LIVE" : "⚫ offline"}
              {alert.lastCheckedAt ? " · проверено " + new Date(alert.lastCheckedAt).toLocaleTimeString() : ""}
              {alert.lastError ? " · " + alert.lastError : ""}
            </div>
          </div>
          <select value={alert.channelId} onChange={(event) => void patch(alert, { channelId: event.target.value })} style={inputStyle}>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
          <select value={alert.mentionRoleId ?? ""} onChange={(event) => void patch(alert, { mentionRoleId: event.target.value || null })} style={inputStyle}>
            <option value="">Без mention</option>
            {roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
          </select>
          <input
            type="number"
            min={15}
            max={3600}
            value={intervalDrafts[alert.id] ?? String(alert.intervalSeconds)}
            onChange={(event) => setIntervalDrafts((current) => ({ ...current, [alert.id]: event.target.value }))}
            onBlur={() => void commitInterval(alert)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            style={inputStyle}
            aria-label={"Интервал проверки для " + alert.target}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={busy} onClick={() => void checkNow(alert)} style={button("secondary")}>
              {checkingId === alert.id ? "Проверка…" : "Проверить"}
            </button>
            <button type="button" disabled={busy} onClick={() => void patch(alert, { enabled: !alert.enabled })} style={button("secondary")}>{alert.enabled ? "ON" : "OFF"}</button>
            <button type="button" disabled={busy} onClick={() => void remove(alert)} style={button("danger")}>Удалить</button>
          </div>
        </div>
      ))}
      {alerts.length === 0 && <div style={{ opacity: 0.42 }}>Уведомлений пока нет.</div>}
    </div>
  );
}

const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #252d39", borderRadius: 8, padding: "9px 10px", color: "#f1f5f9" };
const button = (kind: "primary" | "secondary" | "danger") => ({
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #2c3442",
  cursor: "pointer",
  background: kind === "danger" ? "#3a1c20" : kind === "primary" ? "#243b5a" : "#171d27",
  color: "#f1f5f9"
});
