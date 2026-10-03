"use client";

import { useEffect, useMemo, useState } from "react";

type AnalyticsPoint = { bucketStart: string; eventType: string; count: number };
type AuditActivity = {
  id: string | number;
  actor_user_id: string | null;
  source: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AnalyticsReport = {
  hours: number;
  totals: Record<string, number>;
  points: AnalyticsPoint[];
  counters: {
    messageCount: number;
    memberJoins: number;
    memberLeaves: number;
    voiceJoins: number;
    voiceLeaves: number;
    voiceMoves: number;
  };
};

export function AnalyticsPanel({ guildId }: { guildId: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [activity, setActivity] = useState<AuditActivity[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/analytics?hours=" + hours, { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/analytics/activity?limit=50", { cache: "no-store" })
    ])
      .then(async ([reportResponse, activityResponse]) => {
        const reportBody = await reportResponse.json().catch(() => ({}));
        const activityBody = await activityResponse.json().catch(() => ({}));
        if (!reportResponse.ok) throw new Error(reportBody.error ?? "analytics_failed");
        if (!activityResponse.ok) throw new Error(activityBody.error ?? "analytics_activity_failed");
        return {
          report: reportBody.report as AnalyticsReport,
          activity: (activityBody.activity ?? []) as AuditActivity[]
        };
      })
      .then((next) => {
        if (!cancelled) {
          setReport(next.report);
          setActivity(next.activity);
        }
      })
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a
            href={"/api/guilds/" + encodeURIComponent(guildId) + "/analytics/export?hours=" + hours}
            download
            style={{ ...inputStyle, textDecoration: "none", fontSize: 11 }}
          >
            CSV export
          </a>
          <select value={hours} onChange={(event) => setHours(Number(event.target.value))} style={inputStyle}>
          <option value={24}>24 часа</option>
          <option value={72}>3 дня</option>
          <option value={168}>7 дней</option>
          </select>
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}
      {loading && <div style={{ opacity: 0.45 }}>Загрузка…</div>}

      {!loading && events.length === 0 && <div style={{ opacity: 0.42 }}>Данных пока нет или Analytics выключен.</div>}

      {!loading && report && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <Metric label="Сообщений всего" value={formatNumber(report.counters.messageCount)} />
          <Metric label="Входов / выходов" value={formatNumber(report.counters.memberJoins) + " / " + formatNumber(report.counters.memberLeaves)} />
          <Metric label="Voice событий" value={formatNumber(report.counters.voiceJoins + report.counters.voiceLeaves + report.counters.voiceMoves)} />
        </div>
      )}

      {!loading && activity.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Activity timeline</div>
          <div style={{ display: "grid", gap: 5 }}>
            {activity.slice(0, 20).map((entry) => (
              <div key={String(entry.id)} style={{ display: "grid", gridTemplateColumns: "145px 1fr auto", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 8, background: "#0e131a", border: "1px solid #232a35", fontSize: 10 }}>
                <span style={{ opacity: 0.45 }}>{new Date(entry.created_at).toLocaleString()}</span>
                <span><strong>{entry.action}</strong>{entry.target_id ? " · " + entry.target_id : ""}</span>
                <span style={{ opacity: 0.45 }}>{entry.source}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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


function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, border: "1px solid #232a35", background: "#0e131a" }}>
      <div style={{ opacity: 0.45, fontSize: 9 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("ru-RU") : "0";
}
