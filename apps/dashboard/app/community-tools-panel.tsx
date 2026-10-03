"use client";
import { useEffect, useState } from "react";
type Resource = { id: string; name: string };
type Snapshot = { polls: Array<{ id: number; channelId: string; messageId: string | null; question: string; options: string[]; endsAt: string; closed: boolean }>; suggestions: Array<{ id: number; channelId: string; messageId: string | null; userId: string; content: string; status: "pending" | "approved" | "denied" }>; stickies: Array<{ channelId: string; message: string; lastMessageId: string | null; enabled: boolean }> };
const EMPTY: Snapshot = { polls: [], suggestions: [], stickies: [] };
export function CommunityToolsPanel({ guildId, channels, onChanged }: { guildId: string; channels: Resource[]; onChanged?: () => void | Promise<void> }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [stickyChannelId, setStickyChannelId] = useState("");
  const [stickyMessage, setStickyMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/community-tools", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "community_tools_failed"));
    setSnapshot((body.snapshot ?? EMPTY) as Snapshot);
  }
  useEffect(() => { setError(""); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Community Tools.")); }, [guildId]);
  async function mutate(action: string, input: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/community-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...input }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "community_tools_action_failed"));
      await load(); await onChanged?.();
    } catch (reason) { setError(formatError(reason)); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error && <div style={errorBox}>{error}</div>}
      <section style={panel}><div style={label}>STICKY MESSAGE</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(220px,1.4fr) auto", gap: 8, marginTop: 9 }}>
          <select value={stickyChannelId} onChange={(e) => setStickyChannelId(e.target.value)} style={inputStyle}><option value="">Канал…</option>{channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
          <input value={stickyMessage} onChange={(e) => setStickyMessage(e.target.value)} maxLength={2000} placeholder="Текст sticky" style={inputStyle} />
          <button type="button" disabled={!!busy} onClick={() => void mutate("sticky.set", { channelId: stickyChannelId, message: stickyMessage })} style={button("primary")}>Сохранить</button>
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
          {snapshot.stickies.filter((item) => item.enabled).map((item) => <div key={item.channelId} style={row}><span>#{channels.find((c) => c.id === item.channelId)?.name ?? item.channelId}</span><span style={muted}>{item.message}</span><button type="button" disabled={!!busy} onClick={() => void mutate("sticky.clear", { channelId: item.channelId })} style={button("danger")}>Очистить</button></div>)}
          {!snapshot.stickies.some((item) => item.enabled) && <div style={muted}>Активных sticky нет.</div>}
        </div>
      </section>
      <section style={panel}><div style={label}>POLLS</div>
        {snapshot.polls.length === 0 ? <div style={muted}>Опросов нет.</div> : snapshot.polls.map((poll) => <div key={poll.id} style={row}><div style={{ minWidth: 0, flex: 1 }}><strong>{"#" + poll.id}</strong><div style={{ color: "#c3cbd7", marginTop: 3, fontSize: 10 }}>{poll.question}</div><div style={muted}>{poll.options.join(" · ")} · до {formatDate(poll.endsAt)}</div></div><span style={{ color: poll.closed ? "#687386" : "#79ba91", fontSize: 9 }}>{poll.closed ? "CLOSED" : "ACTIVE"}</span>{!poll.closed && <button type="button" disabled={!!busy} onClick={() => void mutate("poll.close", { id: poll.id })} style={button("secondary")}>Закрыть</button>}</div>)}
      </section>
      <section style={panel}><div style={label}>SUGGESTIONS</div>
        {snapshot.suggestions.length === 0 ? <div style={muted}>Предложений нет.</div> : snapshot.suggestions.map((item) => <div key={item.id} style={row}><div style={{ minWidth: 0, flex: 1 }}><strong>{"#" + item.id + " · " + item.userId}</strong><div style={{ color: "#c3cbd7", marginTop: 3, fontSize: 10, whiteSpace: "pre-wrap" }}>{item.content}</div></div><span style={{ color: item.status === "pending" ? "#d7aa72" : item.status === "approved" ? "#79ba91" : "#d17982", fontSize: 9 }}>{item.status}</span>{item.status === "pending" && <><button type="button" disabled={!!busy} onClick={() => void mutate("suggestion.status", { id: item.id, status: "approved" })} style={button("primary")}>Одобрить</button><button type="button" disabled={!!busy} onClick={() => void mutate("suggestion.status", { id: item.id, status: "denied" })} style={button("danger")}>Отклонить</button></>}</div>)}
      </section>
    </div>
  );
}
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU"); }
function formatError(reason: unknown): string { const code = reason instanceof Error ? reason.message : "community_tools_failed"; const messages: Record<string, string> = { text_channel_required: "Нужен текстовый канал.", bot_missing_send_messages: "Боту не хватает Send Messages в выбранном канале.", sticky_not_found: "Sticky для этого канала не найден." }; return messages[code] ?? code; }
const panel = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const row = { display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px solid #1d232d" } as const;
const label = { color: "#687486", fontSize: 9, letterSpacing: 1.2 } as const;
const muted = { color: "#687386", fontSize: 10 } as const;
const errorBox = { padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 } as const;
const button = (kind: "primary" | "secondary" | "danger") => ({ border: "1px solid " + (kind === "danger" ? "#79343c" : kind === "primary" ? "#405d87" : "#303846"), background: kind === "danger" ? "#4b2227" : kind === "primary" ? "#253c5e" : "#171c25", color: "#f5f7fa", borderRadius: 9, padding: "8px 10px", cursor: "pointer" } as const);
