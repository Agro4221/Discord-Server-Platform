"use client";

import { useEffect, useState } from "react";

type FleetIdentity = {
  id: string;
  clientId: string;
  enabled: boolean;
  presenceName: string | null;
  connected: boolean;
  status: "starting" | "ready" | "degraded" | "stopped";
  lastSeenAt: string | null;
  guildCount: number;
};

export function FleetPanel({
  guildId,
  onChanged
}: {
  guildId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<FleetIdentity[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/fleet", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "fleet_failed");
    setItems(body.identities ?? []);
    setSelected((current) => current || body.identities?.find((item: FleetIdentity) => item.connected)?.id || body.identities?.[0]?.id || "");
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить состояние bot fleet."));
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function assign() {
    if (!guildId || !selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/fleet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId, botIdentityId: selected })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "fleet_assign_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось назначить bot identity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginBottom: 18, padding: 14, border: "1px solid #242934", borderRadius: 14, background: "#11141b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Bot Fleet</div>
          <div style={{ marginTop: 3, opacity: 0.45, fontSize: 11 }}>Распределение guild по отдельным bot-процессам.</div>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={inputStyle}>
            {items.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.status} · {item.guildCount} guilds</option>)}
          </select>
          <button type="button" disabled={busy || !selected} onClick={() => void assign()} style={buttonStyle}>Назначить</button>
        </div>
      </div>
      {error && <div style={{ marginTop: 9, fontSize: 12, color: "#ffb3b3" }}>{error}</div>}
      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {items.map((item) => (
            <span key={item.id} style={{ padding: "5px 8px", borderRadius: 999, border: "1px solid #2a2f3a", fontSize: 11, opacity: item.enabled ? 0.82 : 0.42 }}>
              {item.id}: {item.status}{item.lastSeenAt ? " · " + new Date(item.lastSeenAt).toLocaleTimeString() : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 9,
  padding: "8px 10px",
  maxWidth: 420
} as const;

const buttonStyle = {
  border: "1px solid #303643",
  background: "#171a21",
  color: "#fff",
  borderRadius: 9,
  padding: "9px 11px",
  cursor: "pointer"
} as const;
