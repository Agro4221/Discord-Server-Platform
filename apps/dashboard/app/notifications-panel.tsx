"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Feed = {
  id: number;
  channelId: string;
  url: string;
  enabled: boolean;
  intervalSeconds: number;
  lastPolledAt: string | null;
};

export function NotificationsPanel({
  guildId,
  channels,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [url, setUrl] = useState("");
  const [channelId, setChannelId] = useState("");
  const [interval, setInterval] = useState(300);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editChannelId, setEditChannelId] = useState("");
  const [editInterval, setEditInterval] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "feeds_failed");
    setFeeds(body.feeds ?? []);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить feed'ы."));
  }, [guildId]);

  async function create() {
    if (!url.trim() || !channelId) {
      setError("Укажи HTTPS URL и канал.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), channelId, intervalSeconds: interval })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "feed_create_failed");
      setUrl("");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать feed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(feed: Feed) {
    setEditingId(feed.id);
    setEditUrl(feed.url);
    setEditChannelId(feed.channelId);
    setEditInterval(feed.intervalSeconds);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditUrl("");
    setEditChannelId("");
    setEditInterval(300);
  }

  async function update(feedId: number) {
    if (!editUrl.trim() || !editChannelId || !Number.isSafeInteger(editInterval) || editInterval < 60 || editInterval > 86400) {
      setError("Нужны HTTPS URL, канал и interval 60–86400 секунд.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds/" + feedId, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: editUrl.trim(), channelId: editChannelId, intervalSeconds: editInterval })
      });
      if (!response.ok) throw new Error("feed_update_failed");
      cancelEdit();
      await load();
      await onChanged?.();
    } catch {
      setError("Не удалось изменить feed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(feed: Feed) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds/" + feed.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !feed.enabled })
      });
      if (!response.ok) throw new Error("feed_update_failed");
      await load();
      await onChanged?.();
    } catch {
      setError("Не удалось изменить состояние feed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(feed: Feed) {
    if (!window.confirm("Удалить этот notification feed?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds/" + feed.id, { method: "DELETE" });
      if (!response.ok) throw new Error("feed_delete_failed");
      await load();
      await onChanged?.();
    } catch {
      setError("Не удалось удалить feed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 13 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17 }}>Notifications / RSS / Atom</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>Только HTTPS. Feed poller проверяет SSRF и ограничивает размер ответа.</div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(180px,1fr) 140px auto", gap: 8 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/feed.xml" style={inputStyle} />
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={inputStyle}>
          <option value="">Канал назначения</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <input type="number" min={60} max={86400} value={interval} onChange={(e) => setInterval(Number(e.target.value))} style={inputStyle} />
        <button type="button" disabled={busy} onClick={() => void create()} style={buttonStyle("primary")}>Добавить</button>
      </div>

      {feeds.length === 0 ? (
        <div style={{ opacity: 0.42, padding: "8px 0" }}>Feed'ов пока нет.</div>
      ) : feeds.map((feed) => (
        <div key={feed.id} style={{ padding: "10px 0", borderBottom: "1px solid #1d212b", display: "grid", gap: 8 }}>
          {editingId === feed.id ? (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,2fr) minmax(150px,1fr) 120px auto", gap: 8 }}>
              <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} style={inputStyle} />
              <select value={editChannelId} onChange={(e) => setEditChannelId(e.target.value)} style={inputStyle}>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
              <input type="number" min={60} max={86400} value={editInterval} onChange={(e) => setEditInterval(Number(e.target.value))} style={inputStyle} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => void update(feed.id)} style={buttonStyle("primary")}>Сохранить</button>
                <button type="button" disabled={busy} onClick={cancelEdit} style={buttonStyle("secondary")}>Отмена</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{feed.url}</div>
                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.42 }}>
                  #{feed.channelId} · {feed.intervalSeconds}s · {feed.lastPolledAt ? "checked " + new Date(feed.lastPolledAt).toLocaleString() : "not checked"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => startEdit(feed)} style={buttonStyle("secondary")}>Изменить</button>
                <button type="button" disabled={busy} onClick={() => void toggle(feed)} style={buttonStyle("secondary")}>{feed.enabled ? "ON" : "OFF"}</button>
                <button type="button" disabled={busy} onClick={() => void remove(feed)} style={buttonStyle("danger")}>Удалить</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643";
  return { border: "1px solid " + border, background, color: "#fff", borderRadius: 10, padding: "9px 12px", cursor: "pointer" } as const;
}
const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 9,
  padding: "9px 10px",
  width: "100%",
  boxSizing: "border-box" as const
};