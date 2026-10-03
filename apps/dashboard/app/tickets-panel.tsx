"use client";

import { useEffect, useState } from "react";

type Ticket = {
  id: number;
  channelId: string;
  creatorId: string;
  status: "open" | "closing" | "closed";
  claimedBy: string | null;
  createdAt: string;
  closedAt: string | null;
};

export function TicketsPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "tickets_failed"));
    setTickets((body.tickets ?? []) as Ticket[]);
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить тикеты."));
  }, [guildId]);

  async function closeTicket(ticket: Ticket) {
    if (!window.confirm("Закрыть тикет #" + ticket.id + " и сохранить transcript?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/tickets/" + ticket.id + "/close",
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "ticket_close_failed"));
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось закрыть тикет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Список последних тикетов. Закрытие из Control Center использует transcript и rollback-путь Core.
      </div>
      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 }}>{error}</div>}
      {tickets.length === 0 ? (
        <div style={{ color: "#687386", fontSize: 11 }}>Тикетов пока нет.</div>
      ) : (
        <div style={{ display: "grid", gap: 1 }}>
          {tickets.map((ticket) => (
            <div key={ticket.id} style={{ display: "grid", gridTemplateColumns: "60px 90px minmax(150px,1fr) minmax(130px,1fr) 90px auto", gap: 8, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1d232d" }}>
              <strong>#{ticket.id}</strong>
              <span style={{ color: ticket.status === "open" ? "#79ba91" : "#7a8595", fontSize: 10 }}>{ticket.status}</span>
              <span style={{ color: "#a5afbd", fontSize: 10 }}>creator: {ticket.creatorId}</span>
              <span style={{ color: "#687386", fontSize: 10 }}>{ticket.claimedBy ? "staff: " + ticket.claimedBy : "не забран"} · {formatDate(ticket.createdAt)}</span>
              <a href={"https://discord.com/channels/" + guildId + "/" + ticket.channelId} target="_blank" rel="noreferrer" style={{ color: "#91b8ed", fontSize: 10 }}>Открыть</a>
              {ticket.status === "open" ? (
                <button type="button" disabled={busy} onClick={() => void closeTicket(ticket)} style={button}>Закрыть</button>
              ) : (
                <span style={{ color: "#596577", fontSize: 10 }}>—</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
}

const button = { border: "1px solid #79343c", background: "#4b2227", color: "#f5f7fa", borderRadius: 9, padding: "8px 10px", cursor: "pointer" } as const;
