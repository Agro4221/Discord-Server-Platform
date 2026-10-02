"use client";

import { useEffect, useMemo, useState } from "react";

type AnalyticsPoint = { bucketStart: string; eventType: string; count: number };
type AnalyticsReport = { hours: number; totals: Record<string, number>; points: AnalyticsPoint[] };

export function AnalyticsPanel({ guildId }: { guildId: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/guilds/" + encodeURIComponent(guildId) + "/analytics?hours=" + hours, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "analytics_failed");
        return body.report as AnalyticsReport;
      })
      .then((next) => { if (!cancelled) setReport(next); })
      .catch(() => { if (!cancelled) setError("Не удалось загрузить аналитику."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId, hours]);

  const events = useMemo(
    () => Object.entries(report?.totals ?? {}).sort((a, b) => b[1] - a[1]),
    [report]
  );
  const max = Math.max(1, ...events.map(([, value]) => value));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17 }}>Analytics</h3>
          <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>Минутные buckets событий из PostgreSQL.</div>
        </div>
        <select value={hours} onChange={(event) => setHours(Number(event.target.value))} style={inputStyle}>
          <option value={24}>24 часа</option>
          <option value={72}>3 дня</option>
          <option value={168}>7 дней</option>
        </select>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}
      {loading && <div style={{ opacity: 0.45 }}>Загрузка…</div>}

      {!loading && events.length === 0 && <div style={{ opacity: 0.42 }}>Данных пока нет или Analytics выключен.</div>}

      {!loading && events.length > 0 && (
        <div style={{ display: "grid", gap: 9 }}>
          {events.map(([event, value]) => (
            <div key={event} style={{ display: "grid", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span>{event}</span>
                <span style={{ opacity: 0.55 }}>{value}</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "#171a21", overflow: "hidden" }}>
                <div style={{ height: "100%", width: (value / max * 100) + "%", borderRadius: 999, background: "#5865f2" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 10,
  padding: "9px 10px"
} as const;
