"use client";

import { useEffect, useState } from "react";

type VoiceChannel = { id: string; name: string; type?: number };
type Track = { title: string; author: string; durationMs: number };
type MusicProvider = "auto" | "youtube" | "tiktok" | "yandex_music" | "vk_music" | "spotify" | "soundcloud";
type MusicFilter = "off" | "nightcore" | "vaporwave" | "karaoke" | "rotation" | "tremolo" | "vibrato" | "lowpass";
type MusicState = {
  enabled: boolean;
  initialized: boolean;
  voiceChannelId: string | null;
  textChannelId: string | null;
  paused: boolean;
  volume: number;
  repeatMode: "off" | "track" | "queue";
  autoplay: boolean;
  filters: string[];
  current: Track & { positionMs: number } | null;
  queue: Track[];
  nodeCount: number;
  nodeId: string | null;
};

const EMPTY: MusicState = {
  enabled: false,
  initialized: false,
  voiceChannelId: null,
  textChannelId: null,
  paused: false,
  volume: 100,
  repeatMode: "off",
  autoplay: false,
  filters: [],
  current: null,
  queue: [],
  nodeCount: 0,
  nodeId: null
};

export function MusicPanel({
  guildId,
  channels,
  onChanged
}: {
  guildId: string;
  channels: VoiceChannel[];
  onChanged?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<MusicState>(EMPTY);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<MusicProvider>("auto");
  const [filter, setFilter] = useState<MusicFilter>("off");
  const [voiceChannelId, setVoiceChannelId] = useState("");
  const [seek, setSeek] = useState("");
  const [moveFrom, setMoveFrom] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/music",
      { cache: "no-store" }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "music_state_failed"));
    const next = (body.state ?? EMPTY) as MusicState;
    setState(next);
    if (!voiceChannelId && next.voiceChannelId) setVoiceChannelId(next.voiceChannelId);
    if (next.filters?.length) {
      setFilter(next.filters[0] as MusicFilter);
    } else {
      setFilter("off");
    }
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить состояние Music."));
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [guildId]);

  async function control(
    action: "play" | "pause" | "resume" | "skip" | "stop" | "shuffle" | "repeat" | "seek" | "volume" | "autoplay" | "remove" | "move" | "clear" | "filter",
    input: Record<string, unknown> = {}
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/music",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...input })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "music_action_failed"));
      await load();
      await onChanged?.();
    } catch (reason) {
      setError(formatMusicError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    if (!query.trim()) {
      setError("Укажи название трека или URL.");
      return;
    }
    if (!voiceChannelId) {
      setError("Выбери голосовой канал.");
      return;
    }
    await control("play", { query: query.trim(), voiceChannelId, provider });
    setQuery("");
  }

  async function applyFilter(next: MusicFilter) {
    setFilter(next);
    await control("filter", { filter: next });
  }

  async function doSeek() {
    const seconds = Number(seek);
    if (!Number.isInteger(seconds) || seconds < 0) {
      setError("Seek должен быть целым числом секунд.");
      return;
    }
    await control("seek", { value: seconds });
    setSeek("");
  }

  async function setVolume(event: React.ChangeEvent<HTMLInputElement>) {
    await control("volume", { value: Number(event.target.value) });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Локальный Music Control Center работает через yt-dlp + FFmpeg и принимает прямые ссылки на поддерживаемые источники, включая TikTok, Яндекс Музыку, VK, SoundCloud и Spotify-треки; для текстового поиска доступен Auto/YouTube, а Spotify-трек автоматически разрешается через доступный источник.
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 }}>
          {error}
        </div>
      )}

      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1.2, color: "#687486" }}>PLAYER</div>
            <h3 style={{ margin: "4px 0 0", fontSize: 16 }}>
              {state.current?.title ?? "Ничего не играет"}
            </h3>
            <div style={{ marginTop: 4, color: "#707b8d", fontSize: 10 }}>
              {state.current ? state.current.author + " · " + formatDuration(state.current.positionMs) + " / " + formatDuration(state.current.durationMs) : "Очередь пуста"}
            </div>
          </div>

          <div style={{ color: "#7f8b9e", fontSize: 10, textAlign: "right" }}>
            <div>{state.nodeCount ? "Local yt-dlp + FFmpeg" : "Music engine unavailable"}</div>
            <div>Engine: {state.nodeId ?? "не определён"}</div>
            <div>{state.voiceChannelId ? "Voice: " + state.voiceChannelId : "Voice не подключён"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 150px 170px auto", gap: 8, marginTop: 12 }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Трек / исполнитель / URL"
            style={inputStyle}
          />
          <select value={provider} onChange={(event) => setProvider(event.target.value as MusicProvider)} style={inputStyle}>
            <option value="auto">Auto</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="yandex_music">Яндекс Музыка</option>
            <option value="vk_music">VK Музыка</option>
            <option value="spotify">Spotify</option>
            <option value="soundcloud">SoundCloud</option>
          </select>
          <select value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} style={inputStyle}>
            <option value="">Voice-канал…</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={() => void play()} style={button("primary")}>
            Добавить и играть
          </button>
        </div>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
          <ActionButton disabled={busy || !state.current} onClick={() => void control("pause")}>Пауза</ActionButton>
          <ActionButton disabled={busy || !state.current} onClick={() => void control("resume")}>Продолжить</ActionButton>
          <ActionButton disabled={busy || !state.current} onClick={() => void control("skip")}>Следующий</ActionButton>
          <ActionButton disabled={busy || !state.current} onClick={() => void control("stop")}>Стоп</ActionButton>
          <ActionButton disabled={busy || state.queue.length < 2} onClick={() => void control("shuffle")}>Перемешать</ActionButton>
          <ActionButton disabled={busy || state.queue.length === 0} onClick={() => void control("clear")}>Очистить очередь</ActionButton>
          <select
            value={filter}
            disabled={busy}
            onChange={(event) => void applyFilter(event.target.value as MusicFilter)}
            style={{ ...inputStyle, width: 155 }}
          >
            <option value="off">Filter: Off</option>
            <option value="nightcore">Nightcore</option>
            <option value="vaporwave">Vaporwave</option>
            <option value="karaoke">Karaoke</option>
            <option value="rotation">8D / Rotation</option>
            <option value="tremolo">Tremolo</option>
            <option value="vibrato">Vibrato</option>
            <option value="lowpass">Low Pass</option>
          </select>
          <select
            value={state.repeatMode}
            disabled={busy}
            onChange={(event) => void control("repeat", { mode: event.target.value })}
            style={{ ...inputStyle, width: 130 }}
          >
            <option value="off">Repeat: off</option>
            <option value="track">Repeat: track</option>
            <option value="queue">Repeat: queue</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "110px 110px auto", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input value={moveFrom} onChange={(event) => setMoveFrom(event.target.value)} type="number" min={1} max={100} placeholder="От #" style={inputStyle} />
          <input value={moveTo} onChange={(event) => setMoveTo(event.target.value)} type="number" min={1} max={100} placeholder="К #" style={inputStyle} />
          <button type="button" disabled={busy || state.queue.length < 2} onClick={() => {
            void control("move", { from: Number(moveFrom), to: Number(moveTo) });
            setMoveFrom("");
            setMoveTo("");
          }} style={button("secondary")}>Переместить</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "center", marginTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 9, color: "#95a0b1", fontSize: 10 }}>
            Volume
            <input
              type="range"
              min={0}
              max={200}
              value={state.volume}
              disabled={busy}
              onChange={(event) => void setVolume(event)}
              style={{ flex: 1 }}
            />
            <span>{state.volume}</span>
          </label>
          <input
            value={seek}
            onChange={(event) => setSeek(event.target.value)}
            type="number"
            min={0}
            placeholder="сек."
            style={inputStyle}
          />
          <button type="button" disabled={busy || !state.current} onClick={() => void doSeek()} style={button("secondary")}>Seek</button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, color: "#95a0b1", fontSize: 10 }}>
          <input
            type="checkbox"
            checked={state.autoplay}
            disabled={busy}
            onChange={(event) => void control("autoplay", { enabled: event.target.checked })}
          />
          Autoplay
        </label>
      </section>

      <section style={panel}>
        <div style={{ fontSize: 9, letterSpacing: 1.2, color: "#687486" }}>QUEUE</div>
        <h3 style={{ margin: "4px 0 10px", fontSize: 15 }}>Очередь</h3>
        {state.queue.length === 0 ? (
          <div style={{ color: "#687386", fontSize: 11 }}>Очередь пуста.</div>
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            {state.queue.map((track, index) => (
              <div key={index + track.title} style={{ padding: "8px 0", borderBottom: "1px solid #1d232d", display: "grid", gridTemplateColumns: "35px minmax(0,1fr) 80px 70px", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#667285", fontSize: 10 }}>#{index + 1}</span>
                <div>
                  <div style={{ color: "#d5dbe5", fontSize: 11 }}>{track.title}</div>
                  <div style={{ color: "#657082", fontSize: 9, marginTop: 2 }}>{track.author}</div>
                </div>
                <span style={{ color: "#697487", fontSize: 10, textAlign: "right" }}>{formatDuration(track.durationMs)}</span>
                <button type="button" disabled={busy} onClick={() => void control("remove", { value: index + 1 })} style={button("secondary")}>Удалить</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function formatMusicError(error: unknown): string {
  const code = error instanceof Error ? error.message : "music_failed";
  const messages: Record<string, string> = {
    music_disabled: "Модуль Music выключен.",
    music_unavailable: "Music/yt-dlp + FFmpeg недоступен.",
    voice_channel_required: "Нужен голосовой канал.",
    music_voice_assigned_elsewhere: "Этот voice-канал закреплён за другим bot identity.",
    music_voice_not_assigned: "Этот secondary bot не закреплён за выбранным voice-каналом.",
    music_player_not_started: "Плеер ещё не запущен.",
    music_player_in_other_voice: "Плеер уже работает в другом voice-канале.",
    music_query_required: "Укажи трек или URL.",
    music_track_not_found: "Трек не найден.",
    invalid_music_provider: "Некорректный источник поиска.",
    music_queue_too_short: "В очереди недостаточно треков.",
    invalid_repeat_mode: "Некорректный repeat mode.",
    invalid_seek: "Некорректная позиция seek.",
    invalid_volume: "Некорректная громкость.",
    invalid_music_filter: "Некорректный аудиофильтр."
  };
  return messages[code] ?? code;
}

function ActionButton(props: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={props.disabled} onClick={props.onClick} style={button("secondary")}>{props.children}</button>;
}

const panel = {
  padding: 15,
  border: "1px solid #222a35",
  borderRadius: 14,
  background: "#0d1219"
} as const;

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  border: "1px solid #29313e",
  borderRadius: 9,
  padding: "9px 10px",
  color: "#f1f5f9"
};

const button = (kind: "primary" | "secondary") => ({
  border: "1px solid " + (kind === "primary" ? "#405d87" : "#303846"),
  background: kind === "primary" ? "#253c5e" : "#171c25",
  color: "#f5f7fa",
  borderRadius: 9,
  padding: "9px 12px",
  cursor: "pointer"
} as const);
