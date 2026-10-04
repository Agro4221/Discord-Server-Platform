"use client";

import { useEffect, useMemo, useState } from "react";

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

type Resource = { id: string; name: string; type?: number };
type MusicAssignment = { botIdentityId: string; voiceChannelId: string };

export function FleetPanel({
  guildId,
  onChanged
}: {
  guildId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<FleetIdentity[]>([]);
  const [botSettings, setBotSettings] = useState<{
    id: string;
    clientId: string;
    enabled: boolean;
    presenceName: string | null;
    username: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    tokenConfigured: boolean;
  } | null>(null);
  const [botClientId, setBotClientId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [botPresence, setBotPresence] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [botAvatarData, setBotAvatarData] = useState<string | null>(null);
  const [botBannerData, setBotBannerData] = useState<string | null>(null);
  const [botEnabled, setBotEnabled] = useState(true);
  const [botBusy, setBotBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [voiceChannelId, setVoiceChannelId] = useState("");
  const [musicAssignments, setMusicAssignments] = useState<MusicAssignment[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<Resource[]>([]);
  const [busy, setBusy] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadFleet() {
    const response = await fetch("/api/fleet", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "fleet_failed");
    setItems(body.identities ?? []);
    setSelected((current) =>
      current ||
      body.identities?.find((item: FleetIdentity) => item.connected)?.id ||
      body.identities?.[0]?.id ||
      ""
    );
  }

  async function loadBotSettings() {
    const response = await fetch("/api/bot", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "bot_settings_failed");
    const bot = body.bot;
    setBotSettings(bot ?? null);
    setBotClientId(bot?.clientId ?? "");
    setBotPresence(bot?.presenceName ?? "");
    setBotUsername(bot?.username ?? "");
    setBotAvatarData(null);
    setBotBannerData(null);
    setBotEnabled(bot?.enabled !== false);
  }

  async function loadMusicAssignments() {
    const [assignmentResponse, resourceResponse] = await Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/music-bots", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/resources", { cache: "no-store" })
    ]);

    const assignmentBody = await assignmentResponse.json().catch(() => ({}));
    const resourceBody = await resourceResponse.json().catch(() => ({}));
    if (!assignmentResponse.ok) throw new Error(assignmentBody.error ?? "music_assignments_failed");
    if (!resourceResponse.ok) throw new Error(resourceBody.error ?? "resources_failed");

    setMusicAssignments(assignmentBody.assignments ?? []);
    setVoiceChannels(
      (resourceBody.channels ?? []).filter((item: Resource) => item.type === 2 || item.type === 13)
    );
  }

  useEffect(() => {
    if (!guildId) return;
    setError("");

    void Promise.all([loadFleet(), loadBotSettings(), loadMusicAssignments()])
      .catch(() => setError("Не удалось загрузить состояние bot fleet."));

    const timer = window.setInterval(() => {
      void Promise.all([loadFleet(), loadBotSettings(), loadMusicAssignments()]).catch(() => undefined);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [guildId]);

  const availableChannels = useMemo(
    () => voiceChannels.filter((channel) => !musicAssignments.some((item) => item.voiceChannelId === channel.id)),
    [musicAssignments, voiceChannels]
  );

  async function readImage(file: File): Promise<string> {
    if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) {
      throw new Error("Поддерживаются PNG, JPEG и GIF.");
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("Размер изображения не должен превышать 2 MiB.");
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Не удалось прочитать изображение."));
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.readAsDataURL(file);
    });
  }

  async function saveBotSettings() {
    if (!botClientId.trim()) {
      setError("Укажи Application / Client ID Discord-бота.");
      return;
    }
    if (botUsername.trim().length < 2 || botUsername.trim().length > 32) {
      setError("Username бота должен содержать от 2 до 32 символов.");
      return;
    }
    setBotBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        clientId: botClientId.trim(),
        enabled: botEnabled,
        presenceName: botPresence.trim() || null,
        username: botUsername.trim()
      };
      if (botToken.trim()) payload.token = botToken.trim();
      if (botAvatarData !== null) payload.avatarData = botAvatarData;
      if (botBannerData !== null) payload.bannerData = botBannerData;
      const response = await fetch("/api/bot", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "bot_registration_failed");
      setBotToken("");
      setBotSettings(body.bot ?? null);
      await loadFleet();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось зарегистрировать Discord-бота.");
    } finally {
      setBotBusy(false);
    }
  }

  async function assignGuild() {
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
      await loadFleet();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось назначить bot identity.");
    } finally {
      setBusy(false);
    }
  }

  async function assignMusicBot() {
    if (!guildId || !selected || !voiceChannelId) return;
    setMusicBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/music-bots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botIdentityId: selected, voiceChannelId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "music_assign_failed");
      setVoiceChannelId("");
      await loadMusicAssignments();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось назначить Music bot.");
    } finally {
      setMusicBusy(false);
    }
  }

  async function unassignMusicBot(botIdentityId: string) {
    if (!guildId) return;
    setMusicBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/music-bots?botIdentityId=" + encodeURIComponent(botIdentityId),
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "music_unassign_failed");
      await loadMusicAssignments();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось снять назначение Music bot.");
    } finally {
      setMusicBusy(false);
    }
  }

  return (
    <section style={{ marginBottom: 18, padding: 14, border: "1px solid #242934", borderRadius: 14, background: "#11141b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Bot Fleet</div>
          <div style={{ marginTop: 3, opacity: 0.45, fontSize: 11 }}>Распределение guild и Music voice-каналов по отдельным bot-процессам.</div>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} style={inputStyle}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.status} · {item.guildCount} guilds
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !selected} onClick={() => void assignGuild()} style={buttonStyle}>Назначить guild</button>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #202530" }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Регистрация Discord-бота</div>
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>
          Локальная Control Center хранит токен зашифрованным. При сохранении бот подключается заново; токен обратно не показывается.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 10 }}>
          <input value={botClientId} onChange={(e) => setBotClientId(e.target.value)} placeholder="Application / Client ID" style={fieldStyle} inputMode="numeric" />
          <input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={botSettings?.tokenConfigured ? "Новый токен (оставь пустым, чтобы сохранить текущий)" : "Bot Token"} type="password" autoComplete="new-password" style={fieldStyle} />
          <input value={botUsername} onChange={(e) => setBotUsername(e.target.value)} placeholder="Username бота" maxLength={32} style={fieldStyle} />
          <input value={botPresence} onChange={(e) => setBotPresence(e.target.value)} placeholder="Статус / activity, например: !help" maxLength={128} style={fieldStyle} />
          <label style={fileLabel}>
            Avatar · PNG/JPEG/GIF · до 2 MiB
            <input type="file" accept="image/png,image/jpeg,image/gif" disabled={botBusy} onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readImage(file).then(setBotAvatarData).catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось прочитать avatar."));
              e.currentTarget.value = "";
            }} />
          </label>
          <label style={fileLabel}>
            Banner · PNG/JPEG/GIF · до 2 MiB
            <input type="file" accept="image/png,image/jpeg,image/gif" disabled={botBusy} onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readImage(file).then(setBotBannerData).catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось прочитать banner."));
              e.currentTarget.value = "";
            }} />
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: 9, opacity: 0.42 }}>
          Discord жёстко ограничивает частоту смены username; меняй его только при необходимости. Avatar/banner отправляются только при выборе нового файла.
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 11, opacity: 0.75 }}>
            <input type="checkbox" checked={botEnabled} onChange={(e) => setBotEnabled(e.target.checked)} />
            Бот включён
          </label>
          <button type="button" disabled={botBusy || !botClientId.trim() || (!botSettings?.tokenConfigured && !botToken.trim())} onClick={() => void saveBotSettings()} style={buttonStyle}>
            {botBusy ? "Подключение..." : botSettings?.tokenConfigured ? "Сохранить и переподключить" : "Зарегистрировать и подключить"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #202530" }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Music voice assignments</div>
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>
          Primary обслуживает незакреплённые voice-каналы. Закреплённый channel обслуживается выбранной identity.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} style={inputStyle}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>{item.id} · {item.status}</option>
            ))}
          </select>
          <select value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} style={inputStyle}>
            <option value="">Выбери voice channel</option>
            {availableChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}{channel.type === 13 ? " · stage" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={musicBusy || !selected || !voiceChannelId}
            onClick={() => void assignMusicBot()}
            style={buttonStyle}
          >
            Назначить Music
          </button>
        </div>

        {musicAssignments.length > 0 ? (
          <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
            {musicAssignments.map((assignment) => (
              <div key={assignment.botIdentityId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #2a2f3a", borderRadius: 10 }}>
                <span style={{ fontSize: 11 }}>
                  {assignment.botIdentityId} → {voiceChannels.find((channel) => channel.id === assignment.voiceChannelId)?.name ?? assignment.voiceChannelId}
                </span>
                <button
                  type="button"
                  disabled={musicBusy}
                  onClick={() => void unassignMusicBot(assignment.botIdentityId)}
                  style={smallButtonStyle}
                >
                  Снять
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.38 }}>Дополнительных Music assignments нет.</div>
        )}
      </div>

      {botSettings?.avatarUrl && <img src={botSettings.avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", marginTop: 9 }} />}
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

const fileLabel = {
  display: "grid",
  gap: 5,
  alignItems: "center",
  border: "1px solid #2d3643",
  borderRadius: 9,
  padding: "8px 9px",
  color: "#8993a2",
  fontSize: 9,
  background: "#0f151d"
} as const;

const fieldStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 9,
  padding: "9px 10px"
} as const;

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

const smallButtonStyle = {
  border: "1px solid #303643",
  background: "#171a21",
  color: "#fff",
  borderRadius: 8,
  padding: "6px 9px",
  cursor: "pointer"
} as const;
