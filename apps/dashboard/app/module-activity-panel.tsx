"use client";

import { useEffect, useState } from "react";

type AuditEvent = {
  id?: string;
  action: string;
  source?: "discord" | "dashboard" | "system";
  actor_user_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export function ModuleActivityPanel({
  guildId,
  moduleKey
}: {
  guildId: string;
  moduleKey: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "40" });
      if (append && nextBefore) params.set("before", nextBefore);
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/modules/" +
          encodeURIComponent(moduleKey) + "/activity?" + params.toString(),
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "module_activity_failed"));
      const nextEvents = (body.events ?? []) as AuditEvent[];
      setEvents((current) => append ? [...current, ...nextEvents] : nextEvents);
      setNextBefore(typeof body.nextBefore === "string" && body.nextBefore ? body.nextBefore : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить историю модуля.");
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    setEvents([]);
    setNextBefore(null);
    void load(false);
  }, [guildId, moduleKey]);

  const errors = events.filter((event) => /fail|error|denied|blocked/i.test(event.action));

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "#687486", fontSize: 10 }}>
          {events.length} событий загружено
        </span>
        {errors.length > 0 && (
          <span style={{
            padding: "4px 7px",
            borderRadius: 999,
            border: "1px solid #63292d",
            background: "#32191b",
            color: "#f1c3c5",
            fontSize: 9
          }}>
            {errors.length} error-like
          </span>
        )}
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading || loadingMore}
          style={secondaryButton}
        >
          Обновить
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#687486", fontSize: 10 }}>Загрузка истории…</div>
      ) : error ? (
        <div style={errorStyle}>{error}</div>
      ) : !events.length ? (
        <div style={{ color: "#687486", fontSize: 10 }}>Для этого модуля пока нет audit-событий.</div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 6 }}>
            {events.map((event, index) => {
              const errorLike = /fail|error|denied|blocked/i.test(event.action);
              return (
                <article
                  key={event.id ?? event.action + ":" + event.created_at + ":" + index}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: "1px solid " + (errorLike ? "#63292d" : "#202832"),
                    background: errorLike ? "#251619" : "#0d1219"
                  }}
                >
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong style={{ fontSize: 10, color: errorLike ? "#f0a7aa" : "#dce2eb" }}>{event.action}</strong>
                    <time style={{ color: "#596576", fontSize: 8 }}>{formatDate(event.created_at)}</time>
                  </div>
                  <div style={{ marginTop: 3, color: "#687486", fontSize: 8 }}>
                    {event.source ?? "system"} · {event.target_type ?? "—"} · {event.target_id ?? "—"}
                    {event.actor_user_id ? " · actor " + event.actor_user_id : ""}
                  </div>
                </article>
              );
            })}
          </div>
          {nextBefore && (
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loadingMore}
              style={secondaryButton}
            >
              {loadingMore ? "Загрузка…" : "Загрузить ещё"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
}

const secondaryButton = {
  border: "1px solid #303846",
  background: "#171c24",
  color: "#d7dde6",
  borderRadius: 8,
  padding: "7px 9px",
  cursor: "pointer"
} as const;

const errorStyle = {
  padding: 9,
  borderRadius: 9,
  border: "1px solid #63292d",
  background: "#32191b",
  color: "#f1c3c5",
  fontSize: 10
} as const;
