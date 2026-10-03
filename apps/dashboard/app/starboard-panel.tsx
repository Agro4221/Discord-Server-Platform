"use client";

import { useEffect, useState } from "react";

type Config = { channelId: string | null; threshold: number; ignoreSelfReaction: boolean; ignoreBots: boolean };
type Resource = { id: string; name: string };

export function StarboardPanel({ guildId, channels, onChanged }: { guildId: string; channels: Resource[]; onChanged?: () => void | Promise<void> }) {
  const [config, setConfig] = useState<Config>({ channelId: null, threshold: 3, ignoreSelfReaction: true, ignoreBots: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/starboard", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "starboard_failed"));
    setConfig((body.config ?? config) as Config);
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Starboard."));
  }, [guildId]);

  async function save(patch: Partial<Config>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/starboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...config, ...patch })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "starboard_update_failed"));
      setConfig(body.config as Config);
      await onChanged?.();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 13 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Настройка канала публикации и порога ⭐. Ignore-параметры теперь тоже управляются отсюда.
      </div>
      {error && <div style={errorBox}>{error}</div>}
      <section style={panel}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 120px", gap: 9 }}>
          <select value={config.channelId ?? ""} onChange={(event) => void save({ channelId: event.target.value || null })} style={inputStyle}>
            <option value="">Канал Starboard…</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
          <input type="number" min={1} max={100} value={config.threshold} disabled={busy} onChange={(event) => setConfig((current) => ({ ...current, threshold: Number(event.target.value) }))} onBlur={() => void save({ threshold: config.threshold })} style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
          <label style={checkbox}><input type="checkbox" checked={config.ignoreSelfReaction} disabled={busy} onChange={(event) => void save({ ignoreSelfReaction: event.target.checked })} /> Игнорировать свои ⭐</label>
          <label style={checkbox}><input type="checkbox" checked={config.ignoreBots} disabled={busy} onChange={(event) => void save({ ignoreBots: event.target.checked })} /> Игнорировать ботов</label>
        </div>
      </section>
      <section style={panel}>
        <div style={label}>CURRENT CONFIG</div>
        <div style={{ color: "#9ca6b4", fontSize: 10, marginTop: 7 }}>
          {config.channelId ? "Канал: #" + (channels.find((item) => item.id === config.channelId)?.name ?? config.channelId) : "Канал не настроен"} · порог {config.threshold}
        </div>
      </section>
    </div>
  );
}

function formatError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : "starboard_failed";
  const messages: Record<string, string> = {
    starboard_channel_required: "Укажи текстовый канал Starboard.",
    invalid_starboard_channel: "Некорректный канал.",
    invalid_starboard_threshold: "Порог должен быть от 1 до 100.",
    text_channel_required: "Нужен текстовый канал."
  };
  return messages[code] ?? code;
}

const panel = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const checkbox = { display: "flex", alignItems: "center", gap: 7, color: "#95a0b1", fontSize: 10 } as const;
const label = { color: "#687486", fontSize: 9, letterSpacing: 1.2 } as const;
const errorBox = { padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 } as const;
