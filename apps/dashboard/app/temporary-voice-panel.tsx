"use client";

import { useEffect, useState } from "react";

type Room = {
  channelId: string;
  channelName: string;
  ownerId: string;
  memberCount: number;
  userLimit: number;
};

export function TemporaryVoicePanel(props: {
  guildId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/temporary-voice",
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "temporary_voice_snapshot_failed"));
      setRooms((body.rooms ?? []) as Room[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить Temporary Voice.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [props.guildId]);

  async function reconcile() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/actions/temporary-voice/reconcile",
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "temporary_voice_reconcile_failed"));
      setNotice("Reconciliation завершён.");
      await load();
      await props.onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reconciliation не удался.");
    } finally {
      setBusy(false);
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: "#94a0b2", fontSize: 11 }}>
          Активных временных комнат: <strong style={{ color: "#e7ebf2" }}>{rooms.length}</strong>
        </div>
        <button type="button" disabled={busy} onClick={() => void reconcile()} style={buttonStyle}>
          {busy ? "Сверяем…" : "Reconcile сейчас"}
        </button>
        <button type="button" disabled={busy || loading} onClick={() => void load()} style={buttonStyleSecondary}>
          Обновить
        </button>
      </div>

      <section style={box}>
        <div style={eyebrow}>ACTIVE ROOMS</div>
        {loading ? (
          <div style={muted}>Загружаем…</div>
        ) : rooms.length === 0 ? (
          <div style={muted}>Активных временных комнат нет.</div>
        ) : (
          <div style={{ display: "grid", gap: 1, marginTop: 7 }}>
            {rooms.map((room) => (
              <div key={room.channelId} style={{ padding: "10px 0", borderBottom: "1px solid #1d232d", display: "grid", gridTemplateColumns: "minmax(190px,1.2fr) 170px 100px", gap: 8, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#dce2ea" }}>🔊 #{room.channelName}</div>
                  <div style={{ marginTop: 3, color: "#667284", fontSize: 9 }}>{room.channelId}</div>
                </div>
                <span style={{ color: "#9aa5b5", fontSize: 10 }}>владелец {"<@" + room.ownerId + ">"}</span>
                <span style={{ color: "#8490a0", fontSize: 10, textAlign: "right" }}>{room.memberCount}/{room.userLimit || "∞"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const box = { padding: 12, border: "1px solid #222a35", borderRadius: 12, background: "#0d1219" } as const;
const eyebrow = { color: "#566274", fontSize: 8, letterSpacing: 1.2 } as const;
const muted = { marginTop: 7, color: "#687486", fontSize: 10 } as const;
const buttonStyle = { border: "1px solid #405d87", background: "#253c5e", color: "#fff", borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 10 } as const;
const buttonStyleSecondary = { border: "1px solid #303846", background: "#141922", color: "#dce2eb", borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 10 } as const;
