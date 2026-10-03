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
  messageTemplate: string;
  includeKeywords: string[];
  excludeKeywords: string[];
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
  const [messageTemplate, setMessageTemplate] = useState("📡 **Новая запись из feed**\\n**{title}**\\n{url}");
  const [includeKeywords, setIncludeKeywords] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [editingFeedId, setEditingFeedId] = useState<number | null>(null);
  const [editingTemplate, setEditingTemplate] = useState("");
  const [editingInclude, setEditingInclude] = useState("");
  const [editingExclude, setEditingExclude] = useState("");
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
        body: JSON.stringify({
          url: url.trim(),
          channelId,
          intervalSeconds: interval,
          messageTemplate,
          includeKeywords: includeKeywords.split(",").map((value) => value.trim()).filter(Boolean),
          excludeKeywords: excludeKeywords.split(",").map((value) => value.trim()).filter(Boolean)
        })
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

  async function saveFeedSettings(feed: Feed) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds/" + feed.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageTemplate: editingTemplate,
          includeKeywords: editingInclude.split(",").map((value) => value.trim()).filter(Boolean),
          excludeKeywords: editingExclude.split(",").map((value) => value.trim()).filter(Boolean)
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "feed_settings_update_failed");
      setEditingFeedId(null);
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки feed.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(feed: Feed, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/feeds/" + feed.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error("feed_update_failed");
      await load();
      await onChanged?.();
    } catch {
      setError("Не удалось изменить feed.");
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

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(180px,1fr) 140px auto", gap: 8 }}>

        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/feed.xml" style={inputStyle} />
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={inputStyle}>
          <option value="">Канал назначения</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <input type="number" min={60} max={86400} value={interval} onChange={(e) => setInterval(Number(e.target.value))} style={inputStyle} />
        <button type="button" disabled={busy} onClick={() => void create()} style={buttonStyle("primary")}>Добавить</button>
        </div>
        <input value={messageTemplate} maxLength={1800} onChange={(e) => setMessageTemplate(e.target.value)} placeholder="Template: {title} {url} {timestamp}" style={inputStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={includeKeywords} onChange={(e) => setIncludeKeywords(e.target.value)} placeholder="Include keywords, через запятую" style={inputStyle} />
          <input value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)} placeholder="Exclude keywords, через запятую" style={inputStyle} />
        </div>
      </div>

      {feeds.length === 0 ? (
        <div style={{ opacity: 0.42, padding: "8px 0" }}>Feed'ов пока нет.</div>
      ) : feeds.map((feed) => (
        <div key={feed.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1d212b" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{feed.url}</div>
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.42 }}>
              #{feed.channelId} · {feed.intervalSeconds}s · {feed.includeKeywords.length ? "include: " + feed.includeKeywords.join("|") + " · " : ""}{feed.excludeKeywords.length ? "exclude: " + feed.excludeKeywords.join("|") + " · " : ""}{feed.lastPolledAt ? "checked " + new Date(feed.lastPolledAt).toLocaleString() : "not checked"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditingFeedId(editingFeedId === feed.id ? null : feed.id);
                setEditingTemplate(feed.messageTemplate);
                setEditingInclude(feed.includeKeywords.join(", "));
                setEditingExclude(feed.excludeKeywords.join(", "));
              }}
              style={buttonStyle("secondary")}
            >
              {editingFeedId === feed.id ? "Закрыть" : "Настроить"}
            </button>
            <button type="button" disabled={busy} onClick={() => void patch(feed, !feed.enabled)} style={buttonStyle("secondary")}>{feed.enabled ? "ON" : "OFF"}</button>
            <button type="button" disabled={busy} onClick={() => void remove(feed)} style={buttonStyle("danger")}>Удалить</button>
          </div>
          {editingFeedId === feed.id && (
            <div style={{ gridColumn: "1 / -1", display: "grid", gap: 7, marginTop: 6 }}>
              <input value={editingTemplate} maxLength={1800} onChange={(e) => setEditingTemplate(e.target.value)} placeholder="Template: {title} {url} {timestamp}" style={inputStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                <input value={editingInclude} onChange={(e) => setEditingInclude(e.target.value)} placeholder="Include keywords" style={inputStyle} />
                <input value={editingExclude} onChange={(e) => setEditingExclude(e.target.value)} placeholder="Exclude keywords" style={inputStyle} />
              </div>
              <button type="button" disabled={busy} onClick={() => void saveFeedSettings(feed)} style={buttonStyle("primary")}>Сохранить настройки</button>
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