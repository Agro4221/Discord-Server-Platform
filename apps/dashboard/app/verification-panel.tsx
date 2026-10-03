"use client";

import { useState } from "react";

type Resource = { id: string; name: string };

export function VerificationPanel({ guildId, channels, onChanged }: {
  guildId: string;
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function publish() {
    if (!channelId) {
      setMessage("Выбери текстовый канал.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/verification/panel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "verification_panel_failed"));
      setMessage("Панель Verification опубликована.");
      await onChanged?.();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.5 }}>
        Основные параметры Verification редактируются выше. Здесь находится операционная публикация панели.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) auto", gap: 8 }}>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={inputStyle}>
          <option value="">Канал Verification…</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select>
        <button type="button" disabled={busy} onClick={() => void publish()} style={buttonStyle}>{busy ? "Публикуем…" : "Опубликовать панель"}</button>
      </div>
      {message && <div style={{ color: "#7ea98c", fontSize: 10 }}>{message}</div>}
    </div>
  );
}

function formatError(error: unknown): string {
  const code = error instanceof Error ? error.message : "verification_panel_failed";
  const messages: Record<string, string> = {
    verification_disabled: "Модуль Verification выключен.",
    text_channel_required: "Нужен текстовый канал.",
    bot_missing_send_messages: "Боту не хватает Send Messages в выбранном канале."
  };
  return messages[code] ?? code;
}

const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const buttonStyle = { border: "1px solid #405d87", background: "#253c5e", color: "#f5f7fa", borderRadius: 9, padding: "9px 12px", cursor: "pointer" } as const;
