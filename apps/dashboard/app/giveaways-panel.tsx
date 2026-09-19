"use client";

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

export function GiveawaysPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [items, setItems] = useState<Giveaway[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        <h3 style={{ margin: 0, fontSize: 17 }}>Giveaways</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>
          Активные и завершённые кампании. End и reroll защищены подтверждением и аудируются.
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      {items.length === 0 ? (
        <div style={{ opacity: 0.42 }}>Giveaway-кампаний пока нет.</div>
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
                    <button type="button" disabled={busy} onClick={() => void action(item.id, "reroll")} style={buttonStyle("secondary")}>Reroll</button>
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

function buttonStyle(kind: "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "danger" ? "#4b2227" : "#171a21",
    color: "#fff",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
