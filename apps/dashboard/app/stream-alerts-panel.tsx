"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Platform = "twitch" | "youtube" | "vk" | "kick";
type CredentialProvider = "twitch" | "youtube" | "kick";
type Credential = {
  id: number;
  provider: CredentialProvider;
  label: string;
  createdAt: string;
  updatedAt: string;
};
type Alert = {
  id: number;
  platform: Platform;
  target: string;
  channelId: string;
  mentionRoleId: string | null;
  credentialId: number | null;
  enabled: boolean;
  intervalSeconds: number;
  messageTemplate: string;
  lastOnline: boolean;
  lastError: string | null;
};

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
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [providers, setProviders] = useState<Record<Platform, boolean>>({ twitch: false, youtube: false, vk: true, kick: false });
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [credentialId, setCredentialId] = useState("");
  const [credentialForm, setCredentialForm] = useState<{ provider: CredentialProvider; label: string; clientId: string; clientSecret: string; apiKey: string }>({
    provider: "twitch",
    label: "",
    clientId: "",
    clientSecret: "",
    apiKey: ""
  });
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [target, setTarget] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [mentionRoleId, setMentionRoleId] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [messageTemplate, setMessageTemplate] = useState("{mention} 🔴 {platform}: **{title}** — {author} {url}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "stream_alerts_failed");
    setAlerts(body.alerts ?? []);
    const providerState = body.providers ?? {};
    setProviders({
      twitch: Boolean(providerState.twitch),
      youtube: Boolean(providerState.youtube),
      vk: Boolean(providerState.vk ?? true),
      kick: Boolean(providerState.kick)
    });
    setCredentials(Array.isArray(providerState.credentials) ? providerState.credentials : []);

  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить уведомления."));
  }, [guildId]);

  async function create() {
    if (!target.trim() || !channelId) {
      setError("Укажи источник и Discord-канал.");
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
          target: target.trim(),
          channelId,
          mentionRoleId: mentionRoleId || null,
          credentialId: credentialId ? Number(credentialId) : null,
          intervalSeconds,
          messageTemplate
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "stream_alert_create_failed");
      setTarget("");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать уведомление.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(alert: Alert, patchData: Partial<Pick<Alert, "channelId" | "mentionRoleId" | "credentialId" | "intervalSeconds" | "enabled" | "messageTemplate">>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchData)
      });
      if (!response.ok) throw new Error("stream_alert_update_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить уведомление.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(alert: Alert) {
    if (!window.confirm("Удалить это уведомление?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/stream-alerts/" + alert.id, { method: "DELETE" });
      if (!response.ok) throw new Error("stream_alert_delete_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить уведомление.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential() {
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, string> = {
        provider: credentialForm.provider,
        label: credentialForm.label,
        ...(credentialForm.provider === "youtube"
          ? { apiKey: credentialForm.apiKey }
          : { clientId: credentialForm.clientId, clientSecret: credentialForm.clientSecret })
      };
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/integration-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "integration_credential_save_failed");
      setCredentialForm({ provider: credentialForm.provider, label: "", clientId: "", clientSecret: "", apiKey: "" });
      setShowCredentialForm(false);
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить credential.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential(credential: Credential) {
    if (!window.confirm("Удалить credential «" + credential.label + "»? Привязанные stream alerts переключатся на стандартные credentials бота.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/integration-credentials/" + credential.id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "integration_credential_delete_failed");
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить credential.");
    } finally {
      setBusy(false);
    }
  }

  const hint = platform === "twitch"
    ? "логин Twitch"
    : platform === "youtube"
      ? "ID канала или @handle YouTube"
      : platform === "vk"
      ? "slug канала VK Видео Live"
      : "slug или broadcaster ID Kick";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.55 }}>
        Для каждой подписки можно выбрать отдельный Discord-канал и роль для упоминания. Twitch, YouTube и Kick используют API-учётные данные бота.
      </div>
      <section style={boxStyle}>
        <div style={headerRow}>
          <div>
            <strong>API credentials</strong>
            <div style={subtle}>Учётные данные хранятся в зашифрованном виде и никогда не возвращаются через GET.</div>
          </div>
          <button type="button" disabled={busy} onClick={() => setShowCredentialForm((value) => !value)} style={button("secondary")}>
            {showCredentialForm ? "Отмена" : "+ Credential"}
          </button>
        </div>

        {showCredentialForm && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "130px minmax(140px,1fr)", gap: 8 }}>
              <select value={credentialForm.provider} onChange={(event) => setCredentialForm((current) => ({ ...current, provider: event.target.value as CredentialProvider }))} style={inputStyle}>
                <option value="twitch">Twitch</option>
                <option value="youtube">YouTube</option>
                <option value="kick">Kick</option>
              </select>
              <input value={credentialForm.label} onChange={(event) => setCredentialForm((current) => ({ ...current, label: event.target.value }))} placeholder="Например: Main Twitch" style={inputStyle} />
            </div>
            {credentialForm.provider === "youtube" ? (
              <input type="password" value={credentialForm.apiKey} onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="YouTube API key" style={inputStyle} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input value={credentialForm.clientId} onChange={(event) => setCredentialForm((current) => ({ ...current, clientId: event.target.value }))} placeholder="Client ID" style={inputStyle} />
                <input type="password" value={credentialForm.clientSecret} onChange={(event) => setCredentialForm((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="Client secret" style={inputStyle} />
              </div>
            )}
            <button type="button" disabled={busy || !credentialForm.label.trim()} onClick={() => void saveCredential()} style={button("primary")}>Сохранить credential</button>
          </div>
        )}

        {!credentials.length ? (
          <div style={{ opacity: 0.45 }}>Per-guild credentials не настроены. Stream Alerts могут использовать стандартные credentials из окружения.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {credentials.map((credential) => (
              <div key={credential.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 8px", border: "1px solid #1e2631", borderRadius: 8 }}>
                <strong style={{ width: 80 }}>{credential.provider}</strong>
                <span style={{ flex: 1 }}>{credential.label}</span>
                <button type="button" disabled={busy} onClick={() => setPlatform(credential.provider)} style={button("secondary")}>Использовать</button>
                <button type="button" disabled={busy} onClick={() => void removeCredential(credential)} style={button("danger")}>Удалить</button>
              </div>
            ))}
          </div>
        )}
      </section>


      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "120px minmax(150px,1fr) minmax(140px,1fr) minmax(130px,1fr) 100px auto", gap: 8 }}>
        <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)} style={inputStyle}>
          <option value="twitch">Twitch</option>
          <option value="youtube">YouTube</option>
          <option value="vk">VK Live</option>
          <option value="kick">Kick</option>
        </select>
        <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={hint} style={inputStyle} />
        <select value={credentialId} onChange={(event) => setCredentialId(event.target.value)} style={inputStyle} disabled={platform === "vk"}>
          <option value="">Стандартные credentials</option>
          {credentials.filter((credential) => credential.provider === platform).map((credential) => (
            <option key={credential.id} value={credential.id}>{credential.label}</option>
          ))}
        </select>
        <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
          <option value="">Discord-канал</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
        <select value={mentionRoleId} onChange={(event) => setMentionRoleId(event.target.value)} style={inputStyle}>
          <option value="">Без mention</option>
          {roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
        </select>
        <input type="number" min={15} max={3600} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} style={inputStyle} />
        <input value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} placeholder="{mention} {platform} {title} {author} {url}" style={inputStyle} />
        <button type="button" disabled={busy || !providers[platform]} onClick={() => void create()} style={button("primary")}>
          {providers[platform] ? "Добавить" : "Провайдер не настроен"}
        </button>
      </div>

      {alerts.map((alert) => (
        <div key={alert.id} style={{ display: "grid", gridTemplateColumns: "90px minmax(150px,1fr) minmax(140px,1fr) minmax(130px,1fr) 100px auto", gap: 8, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1d212b" }}>
          <strong>{alert.platform === "twitch" ? "Twitch" : alert.platform === "youtube" ? "YouTube" : alert.platform === "vk" ? "VK Live" : "Kick"}</strong>
          <div>
            <div style={{ fontWeight: 600 }}>{alert.target}</div>
            <div style={{ fontSize: 11, opacity: 0.45 }}>{alert.lastOnline ? "🟢 LIVE" : "⚫ offline"}{alert.lastError ? " · " + alert.lastError : ""}</div>
          </div>
          <select value={String(alert.credentialId ?? "")} onChange={(event) => void patch(alert, { credentialId: event.target.value ? Number(event.target.value) : null })} style={inputStyle} disabled={alert.platform === "vk"}>
            <option value="">Стандартные credentials</option>
            {credentials.filter((credential) => credential.provider === alert.platform).map((credential) => (
              <option key={credential.id} value={credential.id}>{credential.label}</option>
            ))}
          </select>
          <select value={alert.channelId} onChange={(event) => void patch(alert, { channelId: event.target.value })} style={inputStyle}>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
          <select value={alert.mentionRoleId ?? ""} onChange={(event) => void patch(alert, { mentionRoleId: event.target.value || null })} style={inputStyle}>
            <option value="">Без mention</option>
            {roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
          </select>
          <input type="number" min={15} max={3600} value={alert.intervalSeconds} onChange={(event) => void patch(alert, { intervalSeconds: Number(event.target.value) })} style={inputStyle} />
          <input value={alert.messageTemplate} onChange={(event) => void patch(alert, { messageTemplate: event.target.value })} placeholder="{mention} {platform} {title} {author} {url}" style={inputStyle} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={busy} onClick={() => void patch(alert, { enabled: !alert.enabled })} style={button("secondary")}>{alert.enabled ? "ON" : "OFF"}</button>
            <button type="button" disabled={busy} onClick={() => void remove(alert)} style={button("danger")}>Удалить</button>
          </div>
        </div>
      ))}
      {alerts.length === 0 && <div style={{ opacity: 0.42 }}>Уведомлений пока нет.</div>}
    </div>
  );
}

const boxStyle = { padding: 12, border: "1px solid #232a35", borderRadius: 11, background: "#0e131a", display: "grid", gap: 8 };
const headerRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const subtle = { marginTop: 3, opacity: 0.42, fontSize: 10 };
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #252d39", borderRadius: 8, padding: "9px 10px", color: "#f1f5f9" };
const button = (kind: "primary" | "secondary" | "danger") => ({
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #2c3442",
  cursor: "pointer",
  background: kind === "danger" ? "#3a1c20" : kind === "primary" ? "#243b5a" : "#171d27",
  color: "#f1f5f9"
});
