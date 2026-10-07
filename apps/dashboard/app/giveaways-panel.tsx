"use client";

type Resource = { id: string; name: string };

import { useEffect, useState } from "react";

type Giveaway = {
  id: number;
  channelId: string;
  messageId: string | null;
  hostUserId: string;
  prize: string;
  winners: number;
  endsAt: string;
  status: string;
  selectedWinners: string[];
  createdAt: string;
  finishedAt: string | null;
};

export function GiveawaysPanel({ guildId, channels, onChanged }: { guildId: string; channels: Resource[]; onChanged?: () => void | Promise<void> }) {
  const [items, setItems] = useState<Giveaway[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [channelId, setChannelId] = useState("");
  const [hostUserId, setHostUserId] = useState("");
  const [prize, setPrize] = useState("");
  const [winners, setWinners] = useState("1");
  const [minutes, setMinutes] = useState("60");

  async function load() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/giveaways", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "giveaways_failed");
    setItems(body.giveaways ?? []);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить giveaways."));
  }, [guildId]);

  async function create() {
    const winnerCount = Number(winners);
    const duration = Number(minutes);
    if (!channelId || !/^\d{15,25}$/.test(hostUserId) || !prize.trim()) {
      setError("Выбери канал, укажи Host user ID и приз.");
      return;
    }
    if (!Number.isSafeInteger(winnerCount) || winnerCount < 1 || winnerCount > 20 || !Number.isSafeInteger(duration) || duration < 1 || duration > 10080) {
      setError("Победителей: 1–20, длительность: 1–10080 минут.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/giveaways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, hostUserId, prize: prize.trim(), winners: winnerCount, minutes: duration })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "giveaway_create_failed"));
      setPrize("");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(formatGiveawayError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function action(id: number, kind: "end" | "reroll") {
    const question = kind === "end"
      ? "Досрочно завершить giveaway?"
      : "Сделать reroll победителей?";
    if (!window.confirm(question)) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/giveaways/" + id + "/" + kind,
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "giveaway_action_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Операция с giveaway не удалась.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17 }}>Розыгрыши</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>
          Активные и завершённые кампании. End и reroll защищены подтверждением и аудируются.
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      <section style={panelBox}>
        <div style={label}>СОЗДАНИЕ РОЗЫГРЫША</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 110px 110px", gap: 8, marginTop: 9 }}>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={inputStyle}><option value="">Канал…</option>{channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} type="number" min={1} max={10080} placeholder="Длительность, минут" style={inputStyle} />
          <input value={winners} onChange={(e) => setWinners(e.target.value)} type="number" min={1} max={20} placeholder="Победители" style={inputStyle} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "180px minmax(220px,1fr) auto", gap: 8, marginTop: 8 }}>
          <input value={hostUserId} onChange={(e) => setHostUserId(e.target.value)} inputMode="numeric" placeholder="Discord ID организатора" style={inputStyle} />
          <input value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={500} placeholder="Приз" style={inputStyle} />
          <button type="button" disabled={busy} onClick={() => void create()} style={buttonStyle("primary")}>Создать</button>
        </div>
      </section>

      {items.length === 0 ? (
        <div style={{ opacity: 0.42 }}>Розыгрышей пока нет.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <div key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid #1d212b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <div style={{ fontWeight: 650 }}>#{item.id} · {item.prize}</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>
                    {item.status} · {item.winners} победит. · канал {item.channelId}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.42 }}>
                    {item.status === "running" ? "Заканчивается: " + new Date(item.endsAt).toLocaleString() : "Завершён: " + (item.finishedAt ? new Date(item.finishedAt).toLocaleString() : "—")}
                  </div>
                  {item.selectedWinners.length > 0 && (
                    <div style={{ marginTop: 5, fontSize: 12, opacity: 0.62 }}>
                      Победители: {item.selectedWinners.map((id) => "<@" + id + ">").join(", ")}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {item.status === "running" && (
                    <button type="button" disabled={busy} onClick={() => void action(item.id, "end")} style={buttonStyle("danger")}>Завершить</button>
                  )}
                  {item.status === "finished" && (
                    <button type="button" disabled={busy} onClick={() => void action(item.id, "reroll")} style={buttonStyle("secondary")} >Переиграть победителей</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatGiveawayError(error: unknown): string {
  const code = error instanceof Error ? error.message : "giveaway_create_failed";
  const messages: Record<string, string> = {
    giveaways_disabled: "Модуль Giveaways выключен.",
    text_channel_required: "Нужен текстовый канал.",
    bot_missing_send_messages: "Боту не хватает Send Messages в канале.",
    invalid_giveaway_target: "Некорректный Discord ID.",
    invalid_giveaway_prize: "Приз обязателен и ограничен 500 символами.",
    invalid_giveaway_winners: "Количество победителей: 1–20.",
    invalid_giveaway_duration: "Длительность: 1–10080 минут."
  };
  return messages[code] ?? code;
}

const panelBox = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const label = { color: "#566274", fontSize: 9, letterSpacing: 1.2 } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
function buttonStyle(kind: "secondary" | "danger" | "primary") {
  return {
    border: "1px solid " + (kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "danger" ? "#4b2227" : kind === "primary" ? "#253c5e" : "#171a21",
    color: "#fff",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
