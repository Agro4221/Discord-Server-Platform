"use client";

import { useEffect, useState, type ReactNode } from "react";

type Resource = { id: string; name: string };
type Platform = "twitch" | "youtube" | "vk";
type Alert = {
  id: number;
  platform: Platform;
  target: string;
  displayName: string;
  template: string;
  channelId: string;
  mentionRoleId: string | null;
  enabled: boolean;
  intervalSeconds: number;
  lastOnline: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
};

type Draft = Pick<Alert, "platform" | "target" | "displayName" | "template" | "channelId">;

const DEFAULT_TEMPLATE = "Хей! {channel} запустил стрим на канале. Присоединяйся!\\n{url}";

export function StreamAlertsPanel({
  guildId,
  channels,
  roles,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  void roles;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [target, setTarget] = useState("");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "stream_alerts_failed");

    const nextAlerts = (body.alerts ?? []) as Alert[];
    setAlerts(nextAlerts);
    setDrafts(Object.fromEntries(nextAlerts.map((alert) => [
      alert.id,
      {
        platform: alert.platform,
        target: alert.target,
        displayName: alert.displayName,
        template: alert.template,
        channelId: alert.channelId
      }
    ])));
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить уведомления."));
  }, [guildId]);

  useEffect(() => {
    setChannelId((current) => current && channels.some((channel) => channel.id === current)
      ? current
      : (channels[0]?.id ?? ""));
  }, [channels]);

  async function create() {
    if (!displayName.trim() || !target.trim() || !channelId || !template.trim()) {
      setError("Заполни имя стримера, канал, Discord-канал и шаблон.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform,
          channelId,
          displayName: displayName.trim(),
          target: target.trim(),
          template,
          intervalSeconds: 30,
          mentionRoleId: null
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_create_failed");

      setDisplayName("");
      setTarget("");
      setTemplate(DEFAULT_TEMPLATE);
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать источник.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(alert: Alert, patchData: Partial<Draft> & { enabled?: boolean }) {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchData)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_update_failed");

      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить источник.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(alert: Alert) {
    const draft = drafts[alert.id];
    if (!draft || !draft.displayName.trim() || !draft.target.trim() || !draft.channelId || !draft.template.trim()) {
      setError("Заполни все поля источника.");
      return;
    }

    await patch(alert, {
      platform: draft.platform,
      channelId: draft.channelId,
      displayName: draft.displayName.trim(),
      target: draft.target.trim(),
      template: draft.template
    });
  }

  async function checkNow(alert: Alert) {
    setBusy(true);
    setCheckingId(alert.id);
    setError("");

    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_check_failed");

      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить источник.");
    } finally {
      setCheckingId(null);
      setBusy(false);
    }
  }

  async function remove(alert: Alert) {
    if (!window.confirm("Удалить этот источник?")) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "DELETE"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_delete_failed");

      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить источник.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(alertId: number, patchData: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [alertId]: {
        ...current[alertId],
        ...patchData
      }
    }));
  }

  const hint = platform === "twitch"
    ? "https://www.twitch.tv/..."
    : platform === "youtube"
      ? "https://www.youtube.com/@... или ссылка на канал"
      : "https://live.vkvideo.ru/...";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.55 }}>
        Для каждого источника можно задать отображаемое имя и собственный шаблон. Доступны: {"{channel}"}, {"{url}"}, {"{title}"}, {"{platform}"}, {"{viewers}"} и {"{category}"}.
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>
          {error}
        </div>
      )}

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Форма добавления нового источника</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Field label="Платформа">
            <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)} style={inputStyle}>
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
              <option value="vk">VK Видео Live</option>
            </select>
          </Field>

          <Field label="Discord канал для уведомлений">
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
              <option value="">Выберите Discord канал</option>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </Field>

          <Field label="Отображаемое имя стримера">
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Jostik" style={inputStyle} />
          </Field>

          <Field label="Канал на платформе (логин или ссылка)">
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={hint} style={inputStyle} />
          </Field>
        </div>

        <Field label="Шаблон">
          <textarea value={template} onChange={(event) => setTemplate(event.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" as const }} />
        </Field>

        <button type="button" disabled={busy} onClick={() => void create()} style={button("primary")}>Добавить источник</button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Сохранённые источники</div>

        {alerts.length === 0 ? (
          <div style={{ opacity: 0.45 }}>Сохранённых источников пока нет.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {alerts.map((alert) => {
              const draft = drafts[alert.id] ?? {
                platform: alert.platform,
                target: alert.target,
                displayName: alert.displayName,
                template: alert.template,
                channelId: alert.channelId
              };

              return (
                <details key={alert.id} style={detailsStyle}>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    {alert.displayName} · {alert.platform === "twitch" ? "Twitch" : alert.platform === "youtube" ? "YouTube" : "VK Видео Live"} · {channels.find((channel) => channel.id === alert.channelId)?.name ?? "канал не найден"}
                    <span style={{ marginLeft: 8, opacity: 0.55 }}>{alert.enabled ? "● включён" : "● выключен"}</span>
                  </summary>

                  <div style={{ display: "grid", gap: 10, paddingTop: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                      <Field label="Платформа">
                        <select value={draft.platform} onChange={(event) => updateDraft(alert.id, { platform: event.target.value as Platform })} style={inputStyle}>
                          <option value="twitch">Twitch</option>
                          <option value="youtube">YouTube</option>
                          <option value="vk">VK Видео Live</option>
                        </select>
                      </Field>

                      <Field label="Discord канал для уведомлений">
                        <select value={draft.channelId} onChange={(event) => updateDraft(alert.id, { channelId: event.target.value })} style={inputStyle}>
                          <option value="">Выберите Discord канал</option>
                          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                        </select>
                      </Field>

                      <Field label="Отображаемое имя стримера">
                        <input value={draft.displayName} onChange={(event) => updateDraft(alert.id, { displayName: event.target.value })} style={inputStyle} />
                      </Field>

                      <Field label="Канал на платформе (логин или ссылка)">
                        <input value={draft.target} onChange={(event) => updateDraft(alert.id, { target: event.target.value })} style={inputStyle} />
                      </Field>
                    </div>

                    <Field label="Шаблон">
                      <textarea value={draft.template} onChange={(event) => updateDraft(alert.id, { template: event.target.value })} rows={4} style={{ ...inputStyle, resize: "vertical" as const }} />
                    </Field>

                    <div style={{ fontSize: 12, opacity: 0.48 }}>
                      {alert.lastOnline ? "🟢 LIVE" : "⚫ offline"}
                      {alert.lastCheckedAt ? " · проверено " + new Date(alert.lastCheckedAt).toLocaleTimeString() : ""}
                      {alert.lastError ? " · " + alert.lastError : ""}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                      <button type="button" disabled={busy} onClick={() => void saveDraft(alert)} style={button("primary")}>Сохранить источник</button>
                      <button type="button" disabled={busy} onClick={() => void checkNow(alert)} style={button("secondary")}>{checkingId === alert.id ? "Проверка…" : "Проверить сейчас"}</button>
                      <button type="button" disabled={busy} onClick={() => void patch(alert, { enabled: !alert.enabled })} style={button("secondary")}>{alert.enabled ? "Выключить" : "Включить"}</button>
                      <button type="button" disabled={busy} onClick={() => void remove(alert)} style={button("danger")}>Удалить</button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>
      {children}
    </label>
  );
}

const sectionStyle = {
  background: "#111821",
  border: "1px solid #252d39",
  borderRadius: 12,
  padding: 14
};

const sectionTitleStyle = {
  fontWeight: 700,
  marginBottom: 12
};

const detailsStyle = {
  background: "#0f141b",
  border: "1px solid #252d39",
  borderRadius: 10,
  padding: 12
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  border: "1px solid #252d39",
  borderRadius: 8,
  padding: "9px 10px",
  color: "#f1f5f9"
};

const button = (kind: "primary" | "secondary" | "danger") => ({
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #2c3442",
  cursor: "pointer",
  background: kind === "danger" ? "#3a1c20" : kind === "primary" ? "#243b5a" : "#171d27",
  color: "#f1f5f9"
});
