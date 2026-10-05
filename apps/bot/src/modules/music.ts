import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type Message
} from "discord.js";
import {
  LavalinkManager,
  type Player,
  type Track,
  type QueueStoreManager,
  type StoredQueue
} from "lavalink-client";
import type { Database } from "../database.js";
import type { AppConfig } from "../config.js";
import type { BotIdentityRepository } from "../bot-identity.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

declare module "lavalink-client" {
  interface TrackRequester {
    id?: string;
  }
}

type MusicRepeatMode = "off" | "track" | "queue";

const MAX_PLAYLIST_TRACKS = 500;

const MUSIC_FILTER_ACTIONS = [
  "clear", "bassboost-low", "bassboost-medium", "bassboost-high",
  "rock", "classic", "pop", "electronic", "fullsound", "gaming", "nightcore", "8d"
] as const;

type MusicFilterAction = (typeof MUSIC_FILTER_ACTIONS)[number];

export function shuffleMusicItems<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    const current = result[index]!;
    result[index] = result[target]!;
    result[target] = current;
  }
  return result;
}

export function normalizeMusicPlaylistName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return name.length >= 1 ? name : null;
}

export function isMusicFilterAction(value: string): value is MusicFilterAction {
  return (MUSIC_FILTER_ACTIONS as readonly string[]).includes(value);
}

export function nextMusicRepeatMode(mode: MusicRepeatMode): MusicRepeatMode {
  if (mode === "off") return "track";
  if (mode === "track") return "queue";
  return "off";
}

export function nextMusicQueueRepeatMode(mode: MusicRepeatMode): MusicRepeatMode {
  return mode === "queue" ? "off" : "queue";
}

export function clampMusicVolume(value: number): number {
  return Math.min(200, Math.max(0, Math.round(value)));
}
type MusicQueueTrackLike = {
  encoded?: string;
  info: {
    identifier?: string;
    title?: string;
    author?: string | null;
    duration?: number;
    uri?: string | null;
    isSeekable?: boolean;
    isStream?: boolean;
    position?: number;
    artworkUrl?: string | null;
    isrc?: string | null;
    sourceName?: string;
    length?: number;
  };
  requester?: { id?: string };
};

export function buildMusicQueueExport(tracks: MusicQueueTrackLike[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    tracks: tracks.map((track, index) => ({
      position: index + 1,
      identifier: track.info.identifier,
      title: track.info.title,
      author: track.info.author ?? null,
      durationMs: Number(track.info.duration ?? 0),
      uri: (track.info as typeof track.info & { uri?: string | null }).uri ?? null,
      requesterId: typeof track.requester?.id === "string" ? track.requester.id : null
    }))
  }, null, 2);
}

export function buildMusicQueueShare(tracks: MusicQueueTrackLike[]): string {
  const lines = tracks.map((track, index) => {
    const requester = typeof track.requester?.id === "string" ? " · <@" + track.requester.id + ">" : "";
    const uri = (track.info as typeof track.info & { uri?: string | null }).uri;
    const target = uri ? " — " + uri : "";
    return (index + 1) + ". **" + track.info.title + "** — " + (track.info.author ?? "Unknown artist") + requester + target;
  });
  const full = "📋 **Music Queue — " + tracks.length + " трек(ов)**\n" + lines.join("\n");
  if (full.length <= 1900) return full;
  const visible: string[] = [];
  let length = 45;
  for (const line of lines) {
    if (length + line.length + 1 > 1750) break;
    visible.push(line);
    length += line.length + 1;
  }
  const remaining = tracks.length - visible.length;
  return "📋 **Music Queue — " + tracks.length + " трек(ов)**\n" + visible.join("\n") +
    "\n… и ещё **" + remaining + "**. Используй export для полной очереди.";
}

export function voteSkipThreshold(listenerCount: number): number {
  const safe = Math.max(1, Math.floor(listenerCount));
  return Math.max(1, Math.ceil(safe * 0.6));
}

export function isValidMusicSearchSelection(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

export function trimMusicQueueToPosition<T>(queue: T[], position: number): T | null {
  if (!Number.isInteger(position) || position < 1 || position > queue.length) return null;
  const target = queue[position - 1] ?? null;
  if (!target) return null;
  queue.splice(0, position - 1);
  return target;
}


class PostgresQueueStore implements QueueStoreManager {
  constructor(
    private readonly db: Database,
    private readonly botIdentityId: string
  ) {}

  private keyGuild(guildId: string): [string, string] {
    return [guildId, this.botIdentityId];
  }

  async get(guildId: string): Promise<StoredQueue | string | undefined> {
    const [storedGuild, identity] = this.keyGuild(guildId);
    const result = await this.db.query<{ data: unknown }>(
      "SELECT data FROM music_queue_store WHERE guild_id=$1 AND bot_identity_id=$2",
      [storedGuild, identity]
    );
    return result.rows[0] ? JSON.stringify(result.rows[0].data) : undefined;
  }

  async set(guildId: string, data: StoredQueue | string): Promise<void> {
    const [storedGuild, identity] = this.keyGuild(guildId);
    await this.db.query(
      `INSERT INTO music_queue_store(guild_id,bot_identity_id,data)
       VALUES($1,$2,$3::jsonb)
       ON CONFLICT(guild_id,bot_identity_id)
       DO UPDATE SET data=EXCLUDED.data,updated_at=now()`,
      [storedGuild, identity, typeof data === "string" ? data : JSON.stringify(data)]
    );
  }

  async delete(guildId: string): Promise<void> {
    const [storedGuild, identity] = this.keyGuild(guildId);
    await this.db.query(
      "DELETE FROM music_queue_store WHERE guild_id=$1 AND bot_identity_id=$2",
      [storedGuild, identity]
    );
  }

  async parse(data: StoredQueue | string): Promise<Partial<StoredQueue>> {
    return typeof data === "string"
      ? JSON.parse(data) as Partial<StoredQueue>
      : data;
  }

  stringify(data: StoredQueue | string): string {
    return typeof data === "string" ? data : JSON.stringify(data);
  }
}

export class Music implements PlatformModule {
  readonly name = "music";
  private unsubscribe?: () => void;
  private rawHandler?: (data: unknown) => void;
  private readyHandler?: () => void;
  private manager?: LavalinkManager;
  private client?: Client;
  private initialized = false;
  private setModuleHealth?: ModuleContext["setModuleHealth"];
  private healthTimer?: NodeJS.Timeout;
  private readonly connectedNodes = new Set<string>();
  private readonly lastPlayedTracks = new Map<string, Track>();
  private readonly autoplayInFlight = new Set<string>();
  private readonly autoLeaveTimers = new Map<string, NodeJS.Timeout>();
  private readonly requestInFlight = new Set<string>();
  private readonly failoverInFlight = new Set<string>();
  private readonly voteSkipSessions = new Map<string, { trackIdentifier: string; voters: Set<string>; expiresAt: number }>();
  private readonly searchSessions = new Map<string, { guildId: string; userId: string; tracks: Track[]; expiresAt: number }>();
  private searchSequence = 0;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly identities: BotIdentityRepository
  ) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.setModuleHealth = context.setModuleHealth;
    this.connectedNodes.clear();
    this.lastPlayedTracks.clear();
    this.autoplayInFlight.clear();
    this.requestInFlight.clear();
    this.failoverInFlight.clear();
    this.voteSkipSessions.clear();
    for (const timer of this.autoLeaveTimers.values()) clearTimeout(timer);
    this.autoLeaveTimers.clear();

    const queueStore = new PostgresQueueStore(this.db, this.config.botIdentityId);
    const persistedSessions = await this.db.query<{ node_id: string; session_id: string }>(
      "SELECT node_id,session_id FROM music_node_sessions WHERE bot_identity_id=$1",
      [this.config.botIdentityId]
    );
    const resumeSessions = new Map(persistedSessions.rows.map((row) => [row.node_id, row.session_id]));

    this.manager = new LavalinkManager({
      nodes: this.config.lavalinkNodes.map((node) => ({
        id: node.id,
        authorization: node.password,
        host: node.host,
        port: node.port,
        ...(node.secure ? { secure: true } : {}),
        retryAmount: 10,
        retryDelay: 10_000,
        ...(resumeSessions.get(node.id) ? { sessionId: resumeSessions.get(node.id) } : {})
      })),
      sendToShard: (guildId, payload) =>
        this.client?.guilds.cache.get(guildId)?.shard?.send(payload),
      autoSkip: true,
      autoMove: true,
      emitNewSongsOnly: true,
      client: {
        id: this.config.discordClientId,
        username: this.client.user?.username ?? "DSP"
      },
      playerOptions: {
        defaultSearchPlatform: "ytsearch",
        useUnresolvedData: true,
        onDisconnect: {
          autoReconnect: true,
          destroyPlayer: false
        },
        onEmptyQueue: {
          destroyAfterMs: -1
        }
      },
      queueOptions: {
        maxPreviousTracks: 10,
        queueStore
      },
      linksAllowed: true,
      advancedOptions: {
        playerMigration: {
          concurrency: 5,
          perTargetConcurrency: 2,
          backpressureDelayMs: 50
        },
        debugOptions: {
          noAudio: false,
          playerDestroy: {
            dontThrowError: true,
            debugLog: false
          }
        }
      }
    });

    this.rawHandler = (data) => {
      const rawPayload = data as Parameters<LavalinkManager["sendRawData"]>[0];
      void this.manager?.sendRawData(rawPayload);
    };
    this.client.on("raw", this.rawHandler);

    this.readyHandler = () => {
      if (!this.manager || !this.client?.user) return;
      this.manager.init({ ...this.client.user });
      this.initialized = true;
      logger.info("Lavalink manager initialized", {
        identity: this.config.botIdentityId,
        node: this.config.lavalinkHost
      });
    };
    this.client.once("ready", this.readyHandler);

    this.manager.on("trackStart", (player, track) => {
      this.cancelAutoLeave(player.guildId);
      void (async () => {
        const channelId = await this.preferredTextChannelId(player.guildId, player.textChannelId);
        if (channelId && channelId !== player.textChannelId) {
          player.textChannelId = channelId;
          await this.persistPlayer(player);
        }
        if (!track) {
          await this.syncController(player);
          return;
        }
        this.lastPlayedTracks.set(player.guildId, track);
        await this.recordHistory(player.guildId, track).catch((error) => {
          logger.warn("Music history write failed", { guildId: player.guildId, error: String(error) });
        });
        if (await this.announceTrackStart(player.guildId)) {
          await this.announce(channelId, `🎵 Сейчас играет **${track.info.title}** — ${track.info.author}`);
        }
        await this.syncController(player);
      })();
    });

    this.manager.on("trackEnd", (player) => {
      void this.persistPlayer(player);
      void this.syncController(player);
    });

    this.manager.on("queueEnd", (player) => {
      const lastTrack = this.lastPlayedTracks.get(player.guildId);
      void this.syncController(player);
      void (async () => {
        try {
          const autoplay = await this.autoplayEnabled(player.guildId);
          if (lastTrack && shouldAutoplayAfterQueueEnd(
            autoplay,
            player.repeatMode,
            player.queue.tracks.length
          )) {
            await this.autoplayNext(player, lastTrack);
          }
        } catch (error) {
          logger.warn("Music autoplay cycle failed", {
            guildId: player.guildId,
            identity: this.config.botIdentityId,
            error: String(error)
          });
        } finally {
          await this.persistPlayer(player);
          if (player.queue.tracks.length === 0 && !player.queue.current) {
            await this.scheduleAutoLeave(player);
          }
        }
      })();
    });

    this.manager.on("playerUpdate", (_oldPlayer, newPlayer) => {
      void this.persistPlayer(newPlayer);
    });

    this.manager.on("playerDestroy", (player) => {
      this.cancelAutoLeave(player.guildId);
      this.lastPlayedTracks.delete(player.guildId);
      this.autoplayInFlight.delete(player.guildId);
      void this.db.query(
        "DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
        [player.guildId, this.config.botIdentityId]
      );
    });

    this.manager.nodeManager.on("connect", (node) => {
      this.connectedNodes.add(node.id);
      this.publishNodeHealth();
      void this.db.query(
        `INSERT INTO music_node_sessions(bot_identity_id,node_id,session_id)
         VALUES($1,$2,$3)
         ON CONFLICT(bot_identity_id,node_id)
         DO UPDATE SET session_id=EXCLUDED.session_id,updated_at=now()`,
        [this.config.botIdentityId, node.id, node.sessionId]
      ).catch((error) => logger.warn("Failed to persist Lavalink node session", { node: node.id, error: String(error) }));

      void node.updateSession(true, 300_000).catch((error) => {
        logger.warn("Failed to enable Lavalink session resuming", {
          node: node.id,
          error: String(error)
        });
      });
      logger.info("Lavalink node connected", { node: node.id });
    });

    this.manager.nodeManager.on("resumed", (node, _payload, fetchedPlayers) => {
      this.connectedNodes.add(node.id);
      this.publishNodeHealth();
      if (!Array.isArray(fetchedPlayers)) return;
      void this.restoreResumedPlayers(node.id, fetchedPlayers as unknown[]);
    });

    this.manager.nodeManager.on("reconnecting", (node) => {
      this.connectedNodes.delete(node.id);
      this.publishNodeHealth();
      logger.warn("Lavalink node reconnecting", {
        node: node.id
      });
    });

    this.manager.nodeManager.on("disconnect", (node, reason) => {
      this.connectedNodes.delete(node.id);
      this.publishNodeHealth();
      logger.warn("Lavalink node disconnected", {
        node: node.id,
        reason: String(reason)
      });
      void this.failoverPlayersFromNode(node.id);
    });

    this.manager.nodeManager.on("destroy", (node) => {
      this.connectedNodes.delete(node.id);
      this.publishNodeHealth();
      logger.warn("Lavalink node destroyed", {
        node: node.id
      });
      void this.failoverPlayersFromNode(node.id);
    });

    this.manager.nodeManager.on("error", (node, error) => {
      if (!this.connectedNodes.has(node.id)) this.publishNodeHealth();
      logger.error("Lavalink node error", {
        node: node.id,
        error: String(error)
      });
    });

    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    const d = context.events.on("message.create", (message) => this.onRequestMessage(message));
    this.unsubscribe = () => {
      a();
      b();
      d();
    };

    this.healthTimer = setTimeout(() => this.publishNodeHealth(), 0);
    this.healthTimer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    if (this.client && this.rawHandler) {
      this.client.off("raw", this.rawHandler as never);
    }

    if (this.client && this.readyHandler) {
      this.client.off("ready", this.readyHandler);
    }

    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
    this.connectedNodes.clear();
    this.lastPlayedTracks.clear();
    this.autoplayInFlight.clear();
    this.failoverInFlight.clear();
    for (const timer of this.autoLeaveTimers.values()) clearTimeout(timer);
    this.autoLeaveTimers.clear();

    this.rawHandler = undefined;
    this.readyHandler = undefined;
    this.manager = undefined;
    this.client = undefined;
    this.setModuleHealth = undefined;
    this.initialized = false;
  }

  async dashboardState(guildId: string): Promise<{
    enabled: boolean;
    initialized: boolean;
    voiceChannelId: string | null;
    textChannelId: string | null;
    paused: boolean;
    volume: number;
    repeatMode: MusicRepeatMode;
    autoplay: boolean;
    current: { title: string; author: string; durationMs: number; positionMs: number } | null;
    queue: Array<{ title: string; author: string; durationMs: number }>;
    nodeCount: number;
    providers: Array<{ name: string; enabled: boolean; mode: "direct" | "mirror" }>;
  }> {
    const enabled = await moduleEnabled(this.db, guildId, "music", false);
    const player = this.manager?.players.get(guildId);
    const current = player?.queue.current ?? null;
    const positionMs = player
      ? Math.max(0, Number(player.lastPosition ?? 0) + (player.paused ? 0 : Math.max(0, Date.now() - Number(player.lastPositionChange ?? Date.now()))))
      : 0;

    return {
      enabled,
      initialized: this.initialized,
      voiceChannelId: player?.voiceChannelId ?? null,
      textChannelId: player?.textChannelId ?? null,
      paused: player?.paused ?? false,
      volume: player?.volume ?? 100,
      repeatMode: player?.repeatMode ?? "off",
      autoplay: await this.autoplayEnabled(guildId),
      current: current ? {
        title: current.info.title,
        author: current.info.author,
        durationMs: Number(current.info.duration ?? 0),
        positionMs
      } : null,
      queue: (player?.queue.tracks.slice(0, 25) ?? []).map((track) => ({
        title: track.info.title ?? "Unknown track",
        author: track.info.author ?? "Unknown artist",
        durationMs: Number(track.info.duration ?? 0)
      })),
      nodeCount: this.connectedNodes.size,
      providers: [
        { name: "YouTube", enabled: true, mode: "direct" },
        { name: "SoundCloud", enabled: true, mode: "direct" },
        { name: "Spotify", enabled: process.env.LAVASRC_SPOTIFY_ENABLED === "true", mode: "mirror" },
        { name: "Apple Music", enabled: process.env.LAVASRC_APPLEMUSIC_ENABLED === "true", mode: "mirror" },
        { name: "Deezer", enabled: process.env.LAVASRC_DEEZER_ENABLED === "true", mode: "direct" },
        { name: "Yandex Music", enabled: process.env.LAVASRC_YANDEXMUSIC_ENABLED === "true", mode: "direct" },
        { name: "VK Music", enabled: process.env.LAVASRC_VKMUSIC_ENABLED === "true", mode: "direct" },
        { name: "Tidal", enabled: process.env.LAVASRC_TIDAL_ENABLED === "true", mode: "mirror" },
        { name: "Qobuz", enabled: process.env.LAVASRC_QOBUZ_ENABLED === "true", mode: "direct" },
        { name: "yt-dlp", enabled: process.env.LAVASRC_YTDLP_ENABLED === "true", mode: "direct" },
        { name: "JioSaavn", enabled: process.env.LAVASRC_JIOSAAVN_ENABLED === "true", mode: "direct" }
      ]
    };
  }

  async dashboardControl(
    guildId: string,
    action: "play" | "pause" | "resume" | "skip" | "stop" | "shuffle" | "repeat" | "seek" | "volume" | "autoplay",
    input: { query?: string; voiceChannelId?: string; value?: number; mode?: string; enabled?: boolean }
  ): Promise<void> {
    if (!await moduleEnabled(this.db, guildId, "music", false)) throw new Error("music_disabled");
    if (!this.manager || !this.initialized) throw new Error("music_unavailable");

    let player = this.manager.players.get(guildId);

    if (action === "play") {
      const voiceChannelId = input.voiceChannelId;
      if (!voiceChannelId) throw new Error("voice_channel_required");

      const owner = await this.identities.musicVoiceOwner(guildId, voiceChannelId);
      if (owner && owner !== this.config.botIdentityId) throw new Error("music_voice_assigned_elsewhere");
      if (!owner && this.config.botIdentityId !== "primary") throw new Error("music_voice_not_assigned");

      const channel = this.client?.guilds.cache.get(guildId)?.channels.cache.get(voiceChannelId);
      if (!channel || (channel.type !== 2 && channel.type !== 13)) throw new Error("voice_channel_required");

      player ??= this.manager.createPlayer({
        guildId,
        voiceChannelId,
        textChannelId: await this.preferredTextChannelId(guildId, undefined),
        volume: await this.defaultVolume(guildId),
        selfDeaf: true
      });

      if (player.voiceChannelId !== voiceChannelId) throw new Error("music_player_in_other_voice");
      if (!player.connected) await player.connect();

      const query = String(input.query ?? "").trim();
      if (!query) throw new Error("music_query_required");
      const source = /^https?:\/\//i.test(query) ? undefined : "ytsearch";
      const result = await player.search(source ? { query, source } : { query }, this.client?.user);
      if (!result.tracks.length) throw new Error("music_track_not_found");

      player.queue.add(result.tracks[0]!);
      if (!player.playing) await player.play();
      await this.persistPlayer(player);
      return;
    }

    if (!player) throw new Error("music_player_not_started");

    if (action === "pause") {
      await player.pause();
    } else if (action === "resume") {
      await player.resume();
    } else if (action === "skip") {
      await player.skip();
    } else if (action === "stop") {
      await player.stopPlaying();
    } else if (action === "shuffle") {
      if (player.queue.tracks.length < 2) throw new Error("music_queue_too_short");
      await Promise.resolve(player.queue.shuffle());
    } else if (action === "repeat") {
      const mode = normalizeMusicRepeatMode(String(input.mode ?? ""));
      if (!mode) throw new Error("invalid_repeat_mode");
      await player.setRepeatMode(mode);
    } else if (action === "seek") {
      const seconds = Number(input.value);
      const duration = Number(player.queue.current?.info.duration ?? 0);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400 || (duration > 0 && seconds * 1000 >= duration)) {
        throw new Error("invalid_seek");
      }
      await player.seek(seconds * 1000);
    } else if (action === "volume") {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 200) throw new Error("invalid_volume");
      await player.setVolume(value);
    } else if (action === "autoplay") {
      if (typeof input.enabled !== "boolean") throw new Error("invalid_autoplay");
      await this.setAutoplay(guildId, input.enabled);
    }

    await this.persistPlayer(player);
  }

  private publishNodeHealth(): void {
    this.setModuleHealth?.(this.name, musicNodeHealth(this.connectedNodes.size));
  }

  private async failoverPlayersFromNode(failedNodeId: string): Promise<void> {
    if (!this.manager || !this.initialized) return;

    const available = this.manager.nodeManager.leastUsedNodes("playingPlayers")
      .filter((node) => node.id !== failedNodeId && node.connected && Boolean(node.sessionId));
    if (!canFailoverMusicNode(failedNodeId, available.map((node) => node.id))) {
      logger.warn("Music node failover unavailable", {
        identity: this.config.botIdentityId,
        failedNode: failedNodeId
      });
      return;
    }

    const players = [...this.manager.players.values()].filter(
      (player) => player.node.id === failedNodeId
    );

    for (const player of players) {
      if (this.failoverInFlight.has(player.guildId)) continue;
      this.failoverInFlight.add(player.guildId);
      try {
        const current = this.manager?.players.get(player.guildId);
        if (!current || current.node.id !== failedNodeId) continue;

        const target = this.manager?.nodeManager
          .leastUsedNodes("playingPlayers")
          .find((node) => node.id !== failedNodeId && node.connected && Boolean(node.sessionId));
        if (!target) continue;

        await current.moveNode(target.id);
        await this.persistPlayer(current);
        logger.warn("Music player failed over to another Lavalink node", {
          identity: this.config.botIdentityId,
          guildId: current.guildId,
          fromNode: failedNodeId,
          toNode: current.node.id
        });
      } catch (error) {
        logger.warn("Music player failover failed", {
          identity: this.config.botIdentityId,
          guildId: player.guildId,
          failedNode: failedNodeId,
          error: String(error)
        });
      } finally {
        this.failoverInFlight.delete(player.guildId);
      }
    }
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return;
    const directAliases = new Set([
      "play", "search", "pause", "resume", "previous", "skip", "vote-skip", "stop", "shuffle",
      "playlist", "favorite", "filter", "queue-policy", "queue", "repeat", "seek", "volume", "autoplay", "247", "providers", "nowplaying", "lyrics"
    ]);
    if (interaction.commandName !== "music" && !directAliases.has(interaction.commandName)) return;

    const guild = interaction.guild;
    if (!guild) return;

    if (!await moduleEnabled(this.db, guild.id, "music", false)) {
      await interaction.reply({ content: "Модуль Music выключен.", ephemeral: true });
      return;
    }

    if (!this.manager || !this.initialized) {
      await interaction.reply({ content: "Музыкальный движок ещё запускается.", ephemeral: true });
      return;
    }

    const member = await guild.members.fetch(interaction.user.id);
    const voice = member.voice.channel;
    const existingPlayer = this.manager.players.get(guild.id);
    const ownershipChannelId = voice?.id ?? existingPlayer?.voiceChannelId ?? null;

    if (!await this.ensureMusicOwnership(interaction, ownershipChannelId)) return;

    const action = interaction.commandName === "music"
      ? interaction.options.getSubcommand()
      : interaction.commandName;

    switch (action) {
      case "play":
        await this.play(interaction, voice?.id ?? null);
        break;
      case "search":
        await this.search(interaction, voice?.id ?? null);
        break;
      case "pause":
        await this.pause(interaction, true);
        break;
      case "resume":
        await this.pause(interaction, false);
        break;
      case "skip":
        await this.skip(interaction);
        break;
      case "vote-skip":
        await this.voteSkip(interaction);
        break;
      case "skip-to":
        await this.skipTo(interaction);
        break;
      case "history":
        await this.history(interaction);
        break;
      case "stop":
        await this.stop(interaction);
        break;
      case "shuffle":
        await this.shuffle(interaction);
        break;
      case "playlist":
        if (interaction.commandName === "music") await this.savedPlaylist(interaction);
        else await this.queue(interaction);
        break;
      case "favorite":
        await this.favorite(interaction);
        break;
      case "filter":
        await this.filter(interaction);
        break;
      case "queue":
        await this.queue(interaction);
        break;
      case "repeat":
        await this.repeat(interaction);
        break;
      case "autoplay":
        await this.autoplay(interaction);
        break;
      case "247":
        await this.twentyFourSeven(interaction);
        break;
      case "providers":
        await this.providers(interaction);
        break;
      case "seek":
        await this.seek(interaction);
        break;
      case "volume":
        await this.volume(interaction);
        break;
      case "nowplaying":
        await this.nowPlaying(interaction);
        break;
      case "previous":
        await this.previous(interaction);
        break;
      case "lyrics":
        await this.lyrics(interaction);
        break;
    }
  }

  private async search(interaction: ChatInputCommandInteraction, voiceChannelId: string | null): Promise<void> {
    if (!voiceChannelId) {
      await interaction.reply({ content: "Сначала зайди в голосовой канал.", ephemeral: true });
      return;
    }
    const query = interaction.options.getString("query", true).trim();
    if (!query) {
      await interaction.reply({ content: "Поисковый запрос пуст.", ephemeral: true });
      return;
    }
    if (!this.manager) throw new Error("music_manager_unavailable");

    const existing = this.manager.players.get(interaction.guildId!);
    const player = existing ?? await this.manager.createPlayer({
      guildId: interaction.guildId!,
      voiceChannelId,
      textChannelId: await this.preferredTextChannelId(interaction.guildId!, interaction.channelId),
      volume: await this.defaultVolume(interaction.guildId!),
      selfDeaf: true
    });
    if (player.voiceChannelId !== voiceChannelId) throw new Error("music_player_in_other_voice");
    if (!player.connected) await player.connect();

    const result = await player.search(
      { query, source: /^https?:\/\//i.test(query) ? undefined : "ytsearch" },
      interaction.user
    );
    const tracks = result.tracks.slice(0, 5) as Track[];
    if (!tracks.length) {
      await interaction.reply({ content: "Ничего не найдено.", ephemeral: true });
      return;
    }

    const token = Date.now().toString(36) + "-" + (++this.searchSequence).toString(36);
    this.searchSessions.set(token, {
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      tracks,
      expiresAt: Date.now() + 60_000
    });

    const rows = tracks.map((track, index) =>
      new ButtonBuilder()
        .setCustomId("dsp:music:search:" + token + ":" + index)
        .setLabel(String(index + 1))
        .setStyle(ButtonStyle.Secondary)
    );

    const description = tracks.map((track, index) =>
      "**" + (index + 1) + ".** " + track.info.title.slice(0, 80) +
      " — " + String(track.info.author ?? "Unknown").slice(0, 50) +
      " (" + Math.round(Number(track.info.duration ?? 0) / 1000) + "s)"
    ).join("\n");

    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("🔎 Результаты поиска").setDescription(description)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...rows)],
      ephemeral: true
    });
  }

  private async play(interaction: ChatInputCommandInteraction, voiceChannelId: string | null): Promise<void> {
    if (!voiceChannelId) {
      await interaction.reply({ content: "Сначала зайди в голосовой канал.", ephemeral: true });
      return;
    }

    const query = interaction.options.getString("query", true).trim();
    if (!query) {
      await interaction.reply({ content: "Поисковый запрос пуст.", ephemeral: true });
      return;
    }

    const queued = await this.queueQuery(
      interaction.guildId!,
      voiceChannelId,
      interaction.channelId,
      query,
      interaction.user
    );

    if (!queued.added) {
      await interaction.reply({ content: "Ничего не найдено.", ephemeral: true });
      return;
    }

    const suffix = queued.truncated
      ? ` (добавлены первые ${MAX_PLAYLIST_TRACKS} треков)`
      : "";
    await interaction.reply({
      content: `Добавлено в очередь: **${queued.added}** трек(ов)${suffix}. Первый: **${queued.firstTitle}** — ${queued.firstAuthor}`,
      ephemeral: true
    });
  }

  private serializedTrack(track: MusicQueueTrackLike): { encoded?: string; info: Record<string, unknown> } {
    return {
      encoded: track.encoded,
      info: {
        identifier: track.info.identifier ?? "",
        isSeekable: Boolean(track.info.isSeekable),
        author: track.info.author ?? "",
        length: Number((track.info as typeof track.info & { length?: number; duration?: number }).length ?? (track.info as typeof track.info & { duration?: number }).duration ?? 0),
        isStream: Boolean(track.info.isStream),
        position: Number((track.info as typeof track.info & { position?: number }).position ?? 0),
        title: track.info.title,
        uri: (track.info as typeof track.info & { uri?: string | null }).uri ?? null,
        artworkUrl: (track.info as typeof track.info & { artworkUrl?: string | null }).artworkUrl ?? null,
        isrc: (track.info as typeof track.info & { isrc?: string | null }).isrc ?? null,
        sourceName: track.info.sourceName
      }
    };
  }

  private async filter(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guild!.id);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;

    const action = interaction.options.getString("action", true);
    if (!isMusicFilterAction(action)) {
      await interaction.reply({ content: "Неизвестный filter action.", ephemeral: true });
      return;
    }
    try {
      await this.applyFilterAction(player, action);
      await this.persistPlayer(player);
      await this.syncController(player);
      await interaction.reply({ content: "🎚️ Filter применён: **" + action + "**.", ephemeral: true });
    } catch (error) {
      logger.warn("Music filter operation failed", {
        guildId: interaction.guild!.id,
        action,
        error: String(error)
      });
      await interaction.reply({ content: "Не удалось применить этот filter на текущем Lavalink node.", ephemeral: true });
    }
  }

  private async applyFilterAction(player: Player, action: MusicFilterAction): Promise<void> {
    switch (action) {
      case "clear":
        await player.filterManager.resetFilters();
        break;
      case "bassboost-low":
        await player.filterManager.setEQPreset("BassboostLow");
        break;
      case "bassboost-medium":
        await player.filterManager.setEQPreset("BassboostMedium");
        break;
      case "bassboost-high":
        await player.filterManager.setEQPreset("BassboostHigh");
        break;
      case "rock":
        await player.filterManager.setEQPreset("Rock");
        break;
      case "classic":
        await player.filterManager.setEQPreset("Classic");
        break;
      case "pop":
        await player.filterManager.setEQPreset("Pop");
        break;
      case "electronic":
        await player.filterManager.setEQPreset("Electronic");
        break;
      case "fullsound":
        await player.filterManager.setEQPreset("FullSound");
        break;
      case "gaming":
        await player.filterManager.setEQPreset("Gaming");
        break;
      case "nightcore":
        await player.filterManager.toggleNightcore();
        break;
      case "8d":
        await player.filterManager.toggleRotation(0.4);
        break;
    }
  }

  private filterPalette(): ActionRowBuilder<ButtonBuilder>[] {
    const labels: Record<MusicFilterAction, string> = {
      clear: "Clear",
      "bassboost-low": "Bass Low",
      "bassboost-medium": "Bass Med",
      "bassboost-high": "Bass High",
      rock: "Rock",
      classic: "Classic",
      pop: "Pop",
      electronic: "Electronic",
      fullsound: "Full Sound",
      gaming: "Gaming",
      nightcore: "Nightcore",
      "8d": "8D"
    };
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...MUSIC_FILTER_ACTIONS.slice(0, 5).map((action) =>
          new ButtonBuilder().setCustomId("dsp:music:filter:" + action).setLabel(labels[action]).setStyle(ButtonStyle.Secondary)
        )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...MUSIC_FILTER_ACTIONS.slice(5, 10).map((action) =>
          new ButtonBuilder().setCustomId("dsp:music:filter:" + action).setLabel(labels[action]).setStyle(ButtonStyle.Secondary)
        )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...MUSIC_FILTER_ACTIONS.slice(10).map((action) =>
          new ButtonBuilder().setCustomId("dsp:music:filter:" + action).setLabel(labels[action]).setStyle(ButtonStyle.Secondary)
        )
      )
    ];
  }

  private async favorite(interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString("action", true);
    const player = this.manager?.players.get(interaction.guild!.id);

    if (action === "list") {
      const result = await this.db.query<{ track: { info?: { title?: string; author?: string } } }>(
        "SELECT track FROM music_favorites WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 25",
        [interaction.guild!.id, interaction.user.id]
      );
      const lines = result.rows.map((row, index) =>
        (index + 1) + ". **" + String(row.track?.info?.title ?? "Unknown track") + "** — " + String(row.track?.info?.author ?? "Unknown artist")
      );
      await interaction.reply({
        content: lines.length ? "❤️ **Избранное**\n" + lines.join("\n") : "❤️ Избранное пока пусто.",
        ephemeral: true
      });
      return;
    }

    const track = player?.queue.current;
    if (!track) {
      await interaction.reply({ content: "Нужен текущий трек в плеере.", ephemeral: true });
      return;
    }

    if (action === "add") {
      await this.db.query(
        "INSERT INTO music_favorites(guild_id,user_id,identifier,track) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(guild_id,user_id,identifier) DO UPDATE SET track=EXCLUDED.track",
        [interaction.guild!.id,interaction.user.id,track.info.identifier,JSON.stringify(this.serializedTrack(track))]
      );
      await interaction.reply({ content: "❤️ Трек сохранён в избранное.", ephemeral: true });
      return;
    }

    if (action === "remove") {
      const deleted = await this.db.query(
        "DELETE FROM music_favorites WHERE guild_id=$1 AND user_id=$2 AND identifier=$3",
        [interaction.guild!.id,interaction.user.id,track.info.identifier]
      );
      await interaction.reply({
        content: deleted.rowCount ? "🗑️ Трек удалён из избранного." : "Этого трека нет в избранном.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({ content: "Неизвестное действие favorite.", ephemeral: true });
  }

  private async savedPlaylist(interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString("action", true);
    const name = interaction.options.getString("name")?.trim().slice(0, 80) ?? "";
    const guildId = interaction.guild!.id;

    if (action === "list") {
      const result = await this.db.query<{ name: string; tracks: unknown[] }>(
        "SELECT name,tracks FROM music_playlists WHERE guild_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 25",
        [guildId,interaction.user.id]
      );
      const lines = result.rows.map((row, index) =>
        (index + 1) + ". **" + row.name + "** — " + String(Array.isArray(row.tracks) ? row.tracks.length : 0) + " треков"
      );
      await interaction.reply({
        content: lines.length ? "🎼 **Мои плейлисты**\n" + lines.join("\n") : "🎼 Плейлистов пока нет.",
        ephemeral: true
      });
      return;
    }

    if (!name) {
      await interaction.reply({ content: "Укажи имя плейлиста.", ephemeral: true });
      return;
    }

    if (action === "create") {
      try {
        await this.db.query(
          "INSERT INTO music_playlists(guild_id,user_id,name) VALUES($1,$2,$3)",
          [guildId,interaction.user.id,name]
        );
      } catch {
        await interaction.reply({ content: "Плейлист с таким именем уже существует.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: "🎼 Плейлист **" + name + "** создан.", ephemeral: true });
      return;
    }

    const playlist = await this.db.query<{ id: string; tracks: unknown[] }>(
      "SELECT id,tracks FROM music_playlists WHERE guild_id=$1 AND user_id=$2 AND name=$3",
      [guildId,interaction.user.id,name]
    );
    const row = playlist.rows[0];
    if (!row) {
      await interaction.reply({ content: "Плейлист не найден.", ephemeral: true });
      return;
    }

    if (action === "delete") {
      await this.db.query("DELETE FROM music_playlists WHERE id=$1", [row.id]);
      await interaction.reply({ content: "🗑️ Плейлист **" + name + "** удалён.", ephemeral: true });
      return;
    }

    const stored = Array.isArray(row.tracks) ? [...row.tracks] : [];
    const current = this.manager?.players.get(guildId);
    const shouldShuffle = action === "load" && interaction.options.getBoolean("shuffle") === true;

    if (action === "add") {
      const track = current?.queue.current;
      if (!track) {
        await interaction.reply({ content: "Нужен текущий трек в плеере.", ephemeral: true });
        return;
      }
      if (stored.length >= MAX_PLAYLIST_TRACKS) {
        await interaction.reply({ content: "Плейлист уже содержит максимум 500 треков.", ephemeral: true });
        return;
      }

      const existingIds = new Set(
        stored.map((item) => {
          const obj = item as { info?: { identifier?: string } };
          return obj.info?.identifier ?? "";
        })
      );
      if (existingIds.has(track.info.identifier)) {
        await interaction.reply({ content: "Этот трек уже есть в плейлисте.", ephemeral: true });
        return;
      }

      stored.push(this.serializedTrack(track));
      await this.db.query(
        "UPDATE music_playlists SET tracks=$1::jsonb,updated_at=now() WHERE id=$2",
        [JSON.stringify(stored),row.id]
      );
      await interaction.reply({ content: "➕ Трек добавлен в **" + name + "**.", ephemeral: true });
      return;
    }

    if (action === "load") {
      const voice = (await interaction.guild!.members.fetch(interaction.user.id)).voice.channelId;
      if (!voice) {
        await interaction.reply({ content: "Сначала зайди в голосовой канал.", ephemeral: true });
        return;
      }

      const player = current ?? await this.getOrCreatePlayer(interaction, voice);
      if (player.voiceChannelId !== voice) {
        await interaction.reply({ content: "Музыкальный бот уже занят другим голосовым каналом.", ephemeral: true });
        return;
      }
      if (!player.connected) await player.connect();

      let added = 0;
      const itemsToLoad = (shouldShuffle ? shuffleMusicItems(stored) : stored).slice(0, MAX_PLAYLIST_TRACKS);
      for (const item of itemsToLoad) {
        try {
          const built = this.manager?.utils.buildTrack(
            item as Parameters<LavalinkManager["utils"]["buildTrack"]>[0],
            interaction.user
          );
          if (built) {
            player.queue.add(built);
            added += 1;
          }
        } catch (error) {
          logger.warn("Saved music track restore failed", {
            guildId,
            playlist: name,
            error: String(error)
          });
        }
      }

      if (!player.playing && added > 0) await player.play();
      await this.persistPlayer(player);
      await this.syncController(player);
      await interaction.reply({
        content: "▶️ В очередь загружено **" + added + "** треков из **" + name + "**" + (shouldShuffle ? " в случайном порядке" : "") + ".",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({ content: "Неизвестное действие playlist.", ephemeral: true });
  }

  private async previous(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guild!.id);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    await this.previousInteraction(player, interaction);
  }

  private async previousInteraction(player: Player, interaction: ChatInputCommandInteraction | import("discord.js").ButtonInteraction): Promise<void> {
    const previous = player.queue.previous;
    if (!Array.isArray(previous) || previous.length === 0) {
      await interaction.reply({ content: "⏮️ Предыдущего трека нет.", ephemeral: true });
      return;
    }
    try {
      await player.queue.shiftPrevious();
      await this.persistPlayer(player);
      await this.syncController(player);
      await interaction.reply({ content: "⏮️ Вернулся к предыдущему треку.", ephemeral: true });
    } catch (error) {
      logger.warn("Music previous track failed", {
        guildId: player.guildId,
        error: String(error)
      });
      await interaction.reply({ content: "Не удалось вернуть предыдущий трек.", ephemeral: true });
    }
  }

  private async lyrics(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guild!.id);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;

    try {
      const result = await player.getLyrics(player.queue.current!);
      if (!result) {
        await interaction.reply({ content: "📜 Для этого трека текст не найден.", ephemeral: true });
        return;
      }

      const textValue = typeof result.text === "string" && result.text.trim()
        ? result.text.trim()
        : Array.isArray(result.lines)
          ? result.lines.map((line) => String(line.line ?? "")).filter(Boolean).join("\n")
          : "";

      if (!textValue) {
        await interaction.reply({ content: "📜 Для этого трека текст не найден.", ephemeral: true });
        return;
      }

      const chunks: string[] = [];
      for (let i = 0; i < textValue.length; i += 3800) {
        chunks.push(textValue.slice(i, i + 3800));
      }

      await interaction.reply({
        content: chunks.length === 1
          ? "📜 **Текст**\n" + chunks[0]
          : "📜 **Текст, часть 1/" + chunks.length + "**\n" + chunks[0],
        ephemeral: true
      });

      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp({
          content: "📜 **Текст, часть " + (i + 1) + "/" + chunks.length + "**\n" + chunks[i],
          ephemeral: true
        });
      }
    } catch (error) {
      logger.warn("Music lyrics lookup failed", {
        guildId: interaction.guild!.id,
        error: String(error)
      });
      await interaction.reply({
        content: "Не удалось получить текст трека. Возможно, для него нет lyrics source.",
        ephemeral: true
      });
    }
  }

  private async queueQuery(
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    query: string,
    requester: import("discord.js").User
  ): Promise<{ added: number; truncated: boolean; firstTitle: string; firstAuthor: string }> {
    if (!this.manager) throw new Error("music_manager_unavailable");
    if (!await this.canQueueMusic(guildId, requester.id)) throw new Error("music_queue_permission_denied");

    const existing = this.manager.players.get(guildId);
    const player = existing ?? await this.manager.createPlayer({
      guildId,
      voiceChannelId,
      textChannelId: await this.preferredTextChannelId(guildId, textChannelId),
      volume: await this.defaultVolume(guildId),
      selfDeaf: true
    });

    if (player.voiceChannelId !== voiceChannelId) {
      throw new Error("music_player_in_other_voice");
    }
    if (!player.connected) await player.connect();

    const source = /^https?:\/\//i.test(query) ? undefined : "ytsearch";
    const result = await player.search(
      source ? { query, source } : { query },
      requester
    );

    if (!result.tracks.length) {
      return { added: 0, truncated: false, firstTitle: "", firstAuthor: "" };
    }

    const tracks = result.tracks.slice(0, MAX_PLAYLIST_TRACKS);
    for (const track of tracks) player.queue.add(track);
    if (!player.playing) await player.play();

    await this.persistPlayer(player);
    await this.syncController(player);

    const first = tracks[0]!;
    return {
      added: tracks.length,
      truncated: result.tracks.length > tracks.length,
      firstTitle: first.info.title,
      firstAuthor: first.info.author ?? "Unknown artist"
    };
  }

  private async onRequestMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;
    if (!await moduleEnabled(this.db, message.guild.id, "music", false)) return;

    const requestChannelId = await this.requestChannelId(message.guild.id);
    if (!requestChannelId || message.channelId !== requestChannelId) return;

    const query = message.content.trim();
    if (!query) return;

    const key = `${message.guild.id}:${message.author.id}`;
    if (this.requestInFlight.has(key)) {
      await message.reply("⏳ Твой предыдущий запрос ещё обрабатывается.").catch(() => undefined);
      return;
    }

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    const voiceChannelId = member?.voice.channelId ?? null;
    if (!voiceChannelId) {
      await message.reply("🎧 Сначала зайди в голосовой канал.").catch(() => undefined);
      return;
    }

    const owner = await this.identities.musicVoiceOwner(message.guild.id, voiceChannelId);
    if (owner && owner !== this.config.botIdentityId) {
      await message.reply(`🎧 Этот голосовой канал закреплён за bot identity **${owner}**.`).catch(() => undefined);
      return;
    }
    if (!owner && this.config.botIdentityId !== "primary") {
      await message.reply("🎧 Эта voice channel не назначена данной bot identity.").catch(() => undefined);
      return;
    }

    this.requestInFlight.add(key);
    try {
      const queued = await this.queueQuery(
        message.guild.id,
        voiceChannelId,
        message.channelId,
        query,
        message.author
      );
      if (!queued.added) {
        await message.reply("🔎 Ничего не найдено.").catch(() => undefined);
        return;
      }

      const suffix = queued.truncated
        ? ` — добавлены первые ${MAX_PLAYLIST_TRACKS} треков`
        : "";
      await message.reply(
        `✅ В очередь добавлено: **${queued.added}**. Первый: **${queued.firstTitle}** — ${queued.firstAuthor}${suffix}`
      ).catch(() => undefined);
    } catch (error) {
      const messageText = String(error);
      await message.reply(
        messageText.includes("music_player_in_other_voice")
          ? "🎧 Музыкальный бот уже занят другим voice-каналом этого сервера."
          : "❌ Не удалось добавить запрос в очередь."
      ).catch(() => undefined);
      logger.warn("Music channel request failed", {
        guildId: message.guild.id,
        userId: message.author.id,
        error: messageText
      });
    } finally {
      this.requestInFlight.delete(key);
    }
  }

  private async getOrCreatePlayer(
    interaction: ChatInputCommandInteraction,
    voiceChannelId: string
  ) {
    if (!this.manager) throw new Error("music_manager_unavailable");

    const existing = this.manager.players.get(interaction.guildId!);
    if (existing) {
      return existing;
    }

    return this.manager.createPlayer({
      guildId: interaction.guildId!,
      voiceChannelId,
      textChannelId: await this.preferredTextChannelId(interaction.guildId!, interaction.channelId),
      volume: await this.defaultVolume(interaction.guildId!),
      selfDeaf: true
    });
  }

  private async pause(interaction: ChatInputCommandInteraction, paused: boolean): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Музыкальный плеер не запущен.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    if (paused) await player.pause();
    else await player.resume();
    await interaction.reply({ content: paused ? "⏸️ Пауза." : "▶️ Продолжаю.", ephemeral: true });
  }

  private async skip(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    await player.skip();
    await interaction.reply({ content: "⏭️ Пропущено.", ephemeral: true });
  }

  private async voteSkip(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player?.queue.current) {
      await interaction.reply({ content: "Сейчас нечего пропускать.", ephemeral: true });
      return;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.voice.channelId || member.voice.channelId !== player.voiceChannelId) {
      await interaction.reply({ content: "Голосовать за skip можно только из того же голосового канала.", ephemeral: true });
      return;
    }

    const voice = interaction.guild!.channels.cache.get(player.voiceChannelId);
    const listeners = voice && "members" in voice
      ? [...voice.members.values()].filter((candidate) => !candidate.user.bot && !candidate.voice.selfDeaf && !candidate.voice.serverDeaf)
      : [];
    const threshold = voteSkipThreshold(listeners.length);
    const trackIdentifier = player.queue.current.info.identifier;
    const existing = this.voteSkipSessions.get(interaction.guildId!);
    const session = !existing || existing.trackIdentifier !== trackIdentifier || existing.expiresAt < Date.now()
      ? { trackIdentifier, voters: new Set<string>(), expiresAt: Date.now() + 45_000 }
      : existing;

    session.voters.add(interaction.user.id);
    this.voteSkipSessions.set(interaction.guildId!, session);

    if (session.voters.size >= threshold) {
      await player.skip();
      this.voteSkipSessions.delete(interaction.guildId!);
      await this.persistPlayer(player);
      await this.syncController(player);
      await interaction.reply({ content: "⏭️ Vote Skip принят: **" + session.voters.size + "/" + threshold + "**. Трек пропущен.", ephemeral: true });
      return;
    }

    await interaction.reply({
      content: "🗳️ Vote Skip: **" + session.voters.size + "/" + threshold + "** голосов. Голоса действуют 45 секунд.",
      ephemeral: true
    });
  }

  private async stop(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    await player.stopPlaying();
    await interaction.reply({ content: "⏹️ Остановлено.", ephemeral: true });
  }

  private async shuffle(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    if (player.queue.tracks.length < 2) {
      await interaction.reply({ content: "Для перемешивания нужно минимум два трека в очереди.", ephemeral: true });
      return;
    }
    await Promise.resolve(player.queue.shuffle());
    await this.persistPlayer(player);
    await interaction.reply({ content: "🔀 Очередь перемешана.", ephemeral: true });
  }

  private async repeat(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;

    const mode = normalizeMusicRepeatMode(interaction.options.getString("mode", true));
    if (!mode) {
      await interaction.reply({ content: "Неизвестный repeat mode.", ephemeral: true });
      return;
    }

    await player.setRepeatMode(mode);
    await this.persistPlayer(player);
    await interaction.reply({ content: `🔁 Repeat: **${mode}**`, ephemeral: true });
  }

  private async providers(interaction: ChatInputCommandInteraction): Promise<void> {
    const providers: Array<[string,string,boolean]> = [
      ["YouTube","yt",true],
      ["SoundCloud","Lavalink",true],
      ["Spotify","LavaSrc",process.env.LAVASRC_SPOTIFY_ENABLED === "true"],
      ["Apple Music","LavaSrc",process.env.LAVASRC_APPLEMUSIC_ENABLED === "true"],
      ["Deezer","LavaSrc",process.env.LAVASRC_DEEZER_ENABLED === "true"],
      ["Yandex Music","LavaSrc",process.env.LAVASRC_YANDEXMUSIC_ENABLED === "true"],
      ["VK Music","LavaSrc",process.env.LAVASRC_VKMUSIC_ENABLED === "true"],
      ["Tidal","LavaSrc",process.env.LAVASRC_TIDAL_ENABLED === "true"],
      ["Qobuz","LavaSrc",process.env.LAVASRC_QOBUZ_ENABLED === "true"],
      ["yt-dlp","LavaSrc",process.env.LAVASRC_YTDLP_ENABLED === "true"],
      ["JioSaavn","LavaSrc",process.env.LAVASRC_JIOSAAVN_ENABLED === "true"]
    ];
    const lines = providers.map(([name, source, enabled]) =>
      (enabled ? "🟢" : "⚪") + " **" + name + "** · " + source
    );
    await interaction.reply({
      content: "🎵 **Music providers**\n" + lines.join("\n") +
        "\n\n🟡 Spotify/Apple Music могут использовать mirror playback, а не прямой audio source.",
      ephemeral: true
    });
  }

  private async twentyFourSeven(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!await this.canManageMusicMember(interaction.guildId!, member)) {
      await interaction.reply({ content: "24/7 режим настраивается пользователями с DJ-ролью или Manage Server.", ephemeral: true });
      return;
    }
    const enabled = interaction.options.getBoolean("enabled");
    const settings = await this.musicSettings(interaction.guildId!);
    if (enabled === null) {
      await interaction.reply({ content: "24/7: **" + (settings.twentyFourSeven ? "включён" : "выключен") + "**", ephemeral: true });
      return;
    }
    await this.setTwentyFourSeven(interaction.guildId!, enabled);
    await interaction.reply({ content: "24/7 режим " + (enabled ? "включён" : "выключен") + ".", ephemeral: true });
  }

  private async autoplay(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!await this.canManageMusicMember(interaction.guildId!, member)) {
      await interaction.reply({ content: "Autoplay настраивается пользователями с DJ-ролью или Manage Server.", ephemeral: true });
      return;
    }

    const enabled = interaction.options.getBoolean("enabled");
    const current = await this.autoplayEnabled(interaction.guildId!);
    if (enabled === null) {
      await interaction.reply({ content: `Autoplay: **${current ? "включён" : "выключен"}**`, ephemeral: true });
      return;
    }

    await this.setAutoplay(interaction.guildId!, enabled);
    await interaction.reply({ content: `Autoplay ${enabled ? "включён" : "выключен"}.`, ephemeral: true });
  }

  private async seek(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    const track = player?.queue.current;
    if (!player || !track) {
      await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
      return;
    }
    if (!await this.canControl(interaction, player.voiceChannelId)) return;
    const positionSeconds = interaction.options.getInteger("seconds", true);
    const duration = Number(track.info.duration ?? 0);
    if (duration > 0 && positionSeconds * 1000 >= duration) {
      await interaction.reply({ content: "Позиция выходит за длительность текущего трека.", ephemeral: true });
      return;
    }
    await player.seek(positionSeconds * 1000);
    await interaction.reply({ content: `⏩ Позиция: **${positionSeconds} сек.**`, ephemeral: true });
  }

  private async ensureMusicOwnership(
    interaction: ChatInputCommandInteraction,
    voiceChannelId: string | null
  ): Promise<boolean> {
    if (!voiceChannelId) {
      if (this.config.botIdentityId === "primary") return true;
      const assignments = await this.identities.listMusicAssignments(interaction.guildId!);
      return assignments.some((assignment) => assignment.botIdentityId === this.config.botIdentityId);
    }

    const owner = await this.identities.musicVoiceOwner(interaction.guildId!, voiceChannelId);
    if (owner) {
      if (owner === this.config.botIdentityId) return true;
      await interaction.reply({
        content: `Этот голосовой канал закреплён за bot identity **${owner}**.`,
        ephemeral: true
      });
      return false;
    }

    if (this.config.botIdentityId !== "primary") {
      await interaction.reply({
        content: "Эта voice channel не назначена данной bot identity.",
        ephemeral: true
      });
      return false;
    }

    return true;
  }

  private async canControl(interaction: ChatInputCommandInteraction, voiceChannelId: string | null): Promise<boolean> {
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const manageGuild = interaction.memberPermissions?.has("ManageGuild") ?? false;
    const djRole = await this.djRoleId(interaction.guildId!);
    const dj = Boolean(djRole && member?.roles.cache.has(djRole));
    const allowed = canControlMusic(member?.voice.channelId ?? null, voiceChannelId, manageGuild || dj);
    if (!allowed) {
      await interaction.reply({
        content: "Управлять музыкой можно из того же голосового канала, с DJ-ролью или с правом Manage Server.",
        ephemeral: true
      });
    }
    return allowed;
  }

  private async queueAccess(guildId: string): Promise<"everyone" | "dj"> {
    const result = await this.db.query<{ queue_access: "everyone" | "dj" }>("SELECT queue_access FROM music_settings WHERE guild_id=$1",[guildId]);
    return result.rows[0]?.queue_access === "dj" ? "dj" : "everyone";
  }

  private async canQueueMusic(guildId: string, userId: string): Promise<boolean> {
    if (await this.queueAccess(guildId) === "everyone") return true;
    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    return this.canManageMusicMember(guildId, member);
  }

  private async queuePolicy(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!await this.canManageMusicMember(interaction.guildId!, member)) {
      await interaction.reply({ content: "Queue policy меняется только DJ или Manage Server.", ephemeral: true });
      return;
    }
    const value = interaction.options.getString("mode") as "everyone" | "dj" | null;
    const current = await this.queueAccess(interaction.guildId!);
    if (!value) {
      await interaction.reply({ content: "🎵 Queue access: **" + current + "**", ephemeral: true });
      return;
    }
    await this.db.query("INSERT INTO music_settings(guild_id,queue_access) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET queue_access=EXCLUDED.queue_access,updated_at=now()", [interaction.guildId!,value]);
    await interaction.reply({ content: "🎵 Добавлять треки теперь могут: **" + (value === "dj" ? "только DJ / Manage Server" : "все участники") + "**.", ephemeral: true });
  }

  private async djRoleId(guildId: string): Promise<string | null> {
    const result = await this.db.query<{ dj_role_id: string | null }>(
      "SELECT dj_role_id FROM guild_settings WHERE guild_id=$1",
      [guildId]
    );
    return result.rows[0]?.dj_role_id ?? null;
  }

  private async canManageMusicMember(guildId: string, member: import("discord.js").GuildMember | null): Promise<boolean> {
    if (!member) return false;
    if (member.permissions.has("ManageGuild")) return true;
    const djRole = await this.djRoleId(guildId);
    return Boolean(djRole && member.roles.cache.has(djRole));
  }

  private async skipTo(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }
    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!await this.canManageMusicMember(interaction.guildId!, member)) {
      await interaction.reply({ content: "Skip-to доступен DJ или Manage Server.", ephemeral: true });
      return;
    }
    const position = interaction.options.getInteger("position", true);
    const target = trimMusicQueueToPosition(player.queue.tracks, position);
    if (!target) {
      await interaction.reply({ content: "Укажи позицию существующего трека из очереди.", ephemeral: true });
      return;
    }
    await player.skip();
    await this.persistPlayer(player);
    await this.syncController(player);
    await interaction.reply({ content: "⏭️ Пропущено до #" + position + ": **" + target.info.title + "**", ephemeral: true });
  }

  private async history(interaction: ChatInputCommandInteraction): Promise<void> {
    const rows = await this.recentHistory(interaction.guildId!, 20);
    if (!rows.length) {
      await interaction.reply({ content: "🎵 История проигрывания пока пуста.", ephemeral: true });
      return;
    }
    const lines = rows.map((row, index) =>
      (index + 1) + ". **" + row.title + "** — " + row.author +
      (row.requesterId ? " · <@" + row.requesterId + ">" : "") +
      " · " + formatDurationSeconds(Math.floor(row.durationMs / 1000))
    );
    await interaction.reply({ content: "📜 **Недавно проиграно**\n" + lines.join("\n"), ephemeral: true });
  }

  private async recentHistory(guildId: string, limit = 20): Promise<Array<{
    title: string;
    author: string;
    requesterId: string | null;
    durationMs: number;
    playedAt: string;
  }>> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const result = await this.db.query<{
      title: string;
      author: string;
      requester_id: string | null;
      duration_ms: string;
      played_at: string;
    }>(
      "SELECT title,author,requester_id,duration_ms,played_at FROM music_history WHERE guild_id=$1 AND bot_identity_id=$2 ORDER BY played_at DESC,id DESC LIMIT $3",
      [guildId, this.config.botIdentityId, safeLimit]
    );
    return result.rows.map((row) => ({
      title: row.title,
      author: row.author,
      requesterId: row.requester_id,
      durationMs: Number(row.duration_ms) || 0,
      playedAt: row.played_at
    }));
  }

  private async recordHistory(guildId: string, track: Track): Promise<void> {
    const requesterId = typeof track.requester?.id === "string" ? track.requester.id : null;
    await this.db.query(
      "INSERT INTO music_history(guild_id,bot_identity_id,requester_id,title,author,url,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [guildId,this.config.botIdentityId,requesterId,String(track.info.title ?? "Unknown track").slice(0,500),String(track.info.author ?? "").slice(0,300),(track.info.uri ?? null) as string | null,Math.max(0,Math.trunc(Number(track.info.duration ?? 0)))]
    );
    await this.db.query(
      "DELETE FROM music_history WHERE id IN (SELECT id FROM music_history WHERE guild_id=$1 AND bot_identity_id=$2 ORDER BY played_at DESC,id DESC OFFSET 200)",
      [guildId, this.config.botIdentityId]
    );
  }
  private async queue(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
      return;
    }

    const action = interaction.options.getString("action") ?? "view";
    if (action === "export" || action === "share") {
      const tracks = player.queue.tracks;
      if (!tracks.length) {
        await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
        return;
      }
      if (action === "share") {
        await interaction.reply({ content: buildMusicQueueShare(player.queue.tracks), ephemeral: true });
      } else {
        const payload = buildMusicQueueExport(player.queue.tracks);
        await interaction.reply({
          content: "📦 Полная очередь экспортирована в JSON.",
          files: [new AttachmentBuilder(Buffer.from(payload, "utf8"), { name: "vexa-music-queue.json" })],
          ephemeral: true
        });
      }
      return;
    }
    if (action !== "view") {
      const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
      if (!await this.canManageMusicMember(interaction.guildId!, member)) {
        await interaction.reply({ content: "Изменять очередь могут пользователи с DJ-ролью или Manage Server.", ephemeral: true });
        return;
      }
      const queue = player.queue.tracks;
      const position = interaction.options.getInteger("position");
      const to = interaction.options.getInteger("to");
      const from = interaction.options.getInteger("from");
      const end = interaction.options.getInteger("end");
      if (action === "clear") {
        queue.splice(0, queue.length);
        await this.persistPlayer(player);
        await this.syncController(player);
        await interaction.reply({ content: "🧹 Очередь очищена. Текущий трек не остановлен.", ephemeral: true });
        return;
      }
      if (action === "remove") {
        if (!position || position > queue.length) {
          await interaction.reply({ content: "Укажи существующую позицию трека.", ephemeral: true });
          return;
        }
        const removed = queue.splice(position - 1, 1)[0];
        await this.persistPlayer(player);
        await this.syncController(player);
        await interaction.reply({ content: "🗑️ Удалён трек #" + position + ": **" + removed?.info.title + "**", ephemeral: true });
        return;
      }
      if (action === "remove-range") {
        const startPosition = from ?? position;
        const finish = end ?? to;
        if (!startPosition || !finish || startPosition > finish || startPosition < 1 || finish > queue.length) {
          await interaction.reply({ content: "Укажи корректный диапазон from/end.", ephemeral: true });
          return;
        }
        const removed = queue.splice(startPosition - 1, finish - startPosition + 1);
        await this.persistPlayer(player);
        await this.syncController(player);
        await interaction.reply({ content: "🗑️ Удалено треков: **" + removed.length + "** (#" + startPosition + "–" + finish + ").", ephemeral: true });
        return;
      }
      if (action === "move" || action === "front") {
        if (!position || position > queue.length) {
          await interaction.reply({ content: "Укажи существующую позицию трека.", ephemeral: true });
          return;
        }
        const destination = action === "front" ? 1 : (to ?? 0);
        if (destination < 1 || destination > queue.length) {
          await interaction.reply({ content: "Укажи корректную destination position.", ephemeral: true });
          return;
        }
        const moved = queue.splice(position - 1, 1)[0];
        if (!moved) {
          await interaction.reply({ content: "Трек не найден.", ephemeral: true });
          return;
        }
        queue.splice(destination - 1, 0, moved);
        await this.persistPlayer(player);
        await this.syncController(player);
        await interaction.reply({ content: "↕️ Трек перемещён: **" + moved.info.title + "** → #" + destination, ephemeral: true });
        return;
      }
      return;
    }
    const page = this.buildQueuePage(player, 0);
    await interaction.reply({
      content: page.content,
      components: page.components,
      ephemeral: true
    });
  }
  private async volume(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }

    const value = interaction.options.getInteger("value");
    if (value === null) {
      await interaction.reply({ content: `🔊 Громкость: **${player.volume}**`, ephemeral: true });
      return;
    }

    const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!await this.canManageMusicMember(interaction.guildId!, member)) {
      await interaction.reply({ content: "Менять громкость сервера могут пользователи с DJ-ролью или Manage Server.", ephemeral: true });
      return;
    }

    await player.setVolume(value);
    await interaction.reply({ content: `🔊 Громкость: **${value}**`, ephemeral: true });
  }

  private async nowPlaying(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    const track = player?.queue.current;
    if (!player || !track) {
      await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
      return;
    }

    const components = this.buildControllerComponents(player);

    const autoplay = await this.autoplayEnabled(interaction.guildId!);
    const embed = new EmbedBuilder()
      .setTitle("🎵 Сейчас играет")
      .setDescription(`**${track.info.title}**\n${track.info.author}`)
      .addFields(
        {
          name: "Прогресс",
          value: formatTrackProgress(player, track),
          inline: true
        },
        {
          name: "Состояние",
          value: player.paused ? "⏸️ Пауза" : "▶️ Играет",
          inline: true
        },
        {
          name: "Repeat",
          value: player.repeatMode,
          inline: true
        },
        {
          name: "Autoplay",
          value: autoplay ? "включён" : "выключен",
          inline: true
        }
      );

    await interaction.reply({ embeds: [embed], components });
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    const aliases: Record<string, string> = { playlist: "queue" };
    const action = aliases[commandName] ?? commandName;
    const supported = new Set([
      "play", "pause", "resume", "previous", "skip", "skip-to", "history", "stop", "shuffle",
      "queue", "nowplaying", "lyrics", "repeat", "seek", "volume", "autoplay"
    ]);
    if (!supported.has(action)) return false;

    if (!await moduleEnabled(this.db, message.guild.id, "music", false)) {
      await message.reply("Модуль Music выключен.");
      return true;
    }
    if (!this.manager || !this.initialized) {
      await message.reply("Музыкальный движок ещё запускается.");
      return true;
    }

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    const memberVoice = member?.voice.channel;
    const player = this.manager.players.get(message.guild.id);
    const playerVoiceId = player?.voiceChannelId ?? null;
    const manageGuild = member?.permissions.has("ManageGuild") ?? false;
    const djRole = await this.djRoleId(message.guild.id);
    const dj = Boolean(djRole && member?.roles.cache.has(djRole));

    if (action === "play") {
      if (!memberVoice) {
        await message.reply("Сначала зайди в голосовой канал.");
        return true;
      }
      const voiceChannelId = memberVoice.id;
      const owner = await this.identities.musicVoiceOwner(message.guild.id, voiceChannelId);
      if (owner && owner !== this.config.botIdentityId) {
        await message.reply("Этот голосовой канал закреплён за bot identity " + owner + ".");
        return true;
      }
      if (!owner && this.config.botIdentityId !== "primary") {
        await message.reply("Эта voice channel не назначена данной bot identity.");
        return true;
      }

      const query = args.join(" ").trim();
      if (!query) {
        await message.reply("Использование: !play <песня | URL | плейлист>.");
        return true;
      }

      try {
        const queued = await this.queueQuery(
          message.guild.id,
          voiceChannelId,
          message.channelId,
          query,
          message.author
        );
        if (!queued.added) {
          await message.reply("Ничего не найдено.");
          return true;
        }

        const suffix = queued.truncated
          ? " — добавлены первые " + MAX_PLAYLIST_TRACKS + " треков"
          : "";
        await message.reply(
          "🎵 Добавлено в очередь: " + queued.added + ". Первый: " +
          queued.firstTitle + " — " + queued.firstAuthor + suffix
        );
      } catch (error) {
        const messageText = String(error);
        await message.reply(
          messageText.includes("music_player_in_other_voice")
            ? "Музыкальный бот уже находится в другом голосовом канале."
            : "Не удалось добавить запрос в очередь."
        );
        logger.warn("Music prefix play failed", {
          guildId: message.guild.id,
          userId: message.author.id,
          error: messageText
        });
      }
      return true;
    }

    if (!player) {
      await message.reply("Музыка не запущена.");
      return true;
    }

    if (!canControlMusic(memberVoice?.id ?? null, player.voiceChannelId, manageGuild || dj)) {
      await message.reply("Управлять музыкой можно из того же голосового канала или с правом Manage Server.");
      return true;
    }

    if (action === "pause") {
      await player.pause();
      await message.reply("⏸️ Пауза.");
    } else if (action === "resume") {
      await player.resume();
      await message.reply("▶️ Продолжаю.");
    } else if (action === "skip") {
      await player.skip();
      await message.reply("⏭️ Следующий трек.");
    } else if (action === "skip-to") {
      const position = Number(args[0]);
      const target = trimMusicQueueToPosition(player.queue.tracks, position);
      if (!target) {
        await message.reply("Использование: !skip-to <позиция>.");
        return true;
      }
      await player.skip();
      await this.persistPlayer(player);
      await this.syncController(player);
      await message.reply("⏭️ Пропущено до #" + position + ": **" + target.info.title + "**");
    } else if (action === "history") {
      const rows = await this.recentHistory(message.guild.id, 20);
      if (!rows.length) {
        await message.reply("🎵 История проигрывания пока пуста.");
        return true;
      }
      await message.reply("📜 **Недавно проиграно**\n" + rows.map((row, index) => (index + 1) + ". **" + row.title + "** — " + row.author).join("\n"));
    } else if (action === "stop") {
      await player.stopPlaying();
      await message.reply("⏹️ Остановлено.");
    } else if (action === "shuffle") {
      if (player.queue.tracks.length < 2) {
        await message.reply("Для перемешивания нужно минимум два трека.");
        return true;
      }
      await Promise.resolve(player.queue.shuffle());
      await this.persistPlayer(player);
      await message.reply("🔀 Очередь перемешана.");
    } else if (action === "previous") {
      const previous = player.queue.previous;
      if (!Array.isArray(previous) || previous.length === 0) {
        await message.reply("⏮️ Предыдущего трека нет.");
        return true;
      }
      try {
        await player.queue.shiftPrevious();
        await this.persistPlayer(player);
        await this.syncController(player);
        await message.reply("⏮️ Вернулся к предыдущему треку.");
      } catch (error) {
        logger.warn("Music prefix previous track failed", { guildId: message.guild.id, error: String(error) });
        await message.reply("Не удалось вернуть предыдущий трек.");
      }
      return true;
    } else if (action === "lyrics") {
      await message.reply("Используй /music lyrics или кнопку 📜 в контроллере.");
      return true;
    } else if (action === "queue") {
      const page = this.buildQueuePage(player, 0);
      await message.reply({ content: page.content, components: page.components });
    } else if (action === "nowplaying") {
      const track = player.queue.current;
      if (!track) {
        await message.reply("Сейчас ничего не играет.");
        return true;
      }
      const embed = new EmbedBuilder()
        .setTitle("🎵 Сейчас играет")
        .setDescription("**" + track.info.title + "**\n" + track.info.author)
        .addFields(
          { name: "Состояние", value: player.paused ? "⏸️ Пауза" : "▶️ Играет", inline: true },
          { name: "Repeat", value: player.repeatMode, inline: true },
          { name: "Volume", value: String(player.volume), inline: true }
        );
      await message.reply({ embeds: [embed], components: this.buildControllerComponents(player) });
    } else if (action === "repeat") {
      const mode = normalizeMusicRepeatMode((args[0] ?? "").toLowerCase());
      if (!mode) {
        await message.reply("Использование: !repeat off|track|queue.");
        return true;
      }
      await player.setRepeatMode(mode);
      await this.persistPlayer(player);
      await message.reply("🔁 Repeat: " + mode);
    } else if (action === "seek") {
      const seconds = Number(args[0]);
      const track = player.queue.current;
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400 || !track) {
        await message.reply("Использование: !seek <секунды>.");
        return true;
      }
      const duration = Number(track.info.duration ?? 0);
      if (duration > 0 && seconds * 1000 >= duration) {
        await message.reply("Позиция выходит за длительность текущего трека.");
        return true;
      }
      await player.seek(seconds * 1000);
      await message.reply("⏩ Позиция: " + seconds + " сек.");
    } else if (action === "volume") {
      const value = args.length ? Number(args[0]) : null;
      if (value === null) {
        await message.reply("🔊 Громкость: " + player.volume);
        return true;
      }
      if (!Number.isInteger(value) || value < 0 || value > 200 || !(manageGuild || dj)) {
        await message.reply("Для изменения громкости нужен Manage Server и значение 0–200.");
        return true;
      }
      await player.setVolume(value);
      await message.reply("🔊 Громкость: " + value);
    } else if (action === "autoplay") {
      if (!(manageGuild || dj)) {
        await message.reply("Autoplay настраивается пользователями с DJ-ролью или Manage Server.");
        return true;
      }
      const raw = (args[0] ?? "").toLowerCase();
      if (!["on", "off"].includes(raw)) {
        const current = await this.autoplayEnabled(message.guild.id);
        await message.reply("Autoplay: " + (current ? "включён" : "выключен"));
        return true;
      }
      const enabled = raw === "on";
      await this.setAutoplay(message.guild.id, enabled);
      await message.reply("Autoplay " + (enabled ? "включён" : "выключен") + ".");
    }

    return true;
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isModalSubmit() && interaction.customId === "dsp:music:save-queue" && interaction.guild) {
      const player = this.manager?.players.get(interaction.guild.id);
      if (!player) {
        await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
        return;
      }
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!canControlMusic(member?.voice.channelId ?? null, player.voiceChannelId, interaction.memberPermissions?.has("ManageGuild") ?? false)) {
        await interaction.reply({ content: "Сохранять очередь можно из того же голосового канала.", ephemeral: true });
        return;
      }

      const name = normalizeMusicPlaylistName(interaction.fields.getTextInputValue("name"));
      if (!name) {
        await interaction.reply({ content: "Название плейлиста пустое или некорректное.", ephemeral: true });
        return;
      }

      const tracks = [
        ...(player.queue.current ? [player.queue.current] : []),
        ...player.queue.tracks
      ].slice(0, MAX_PLAYLIST_TRACKS);

      if (!tracks.length) {
        await interaction.reply({ content: "Нечего сохранять: очередь пуста.", ephemeral: true });
        return;
      }

      try {
        await this.db.query(
          "INSERT INTO music_playlists(guild_id,user_id,name,tracks) VALUES($1,$2,$3,$4::jsonb)",
          [
            interaction.guild.id,
            interaction.user.id,
            name,
            JSON.stringify(tracks.map((track) => this.serializedTrack(track)))
          ]
        );
      } catch (error) {
        const message = String(error);
        if (/unique|duplicate|23505/i.test(message)) {
          await interaction.reply({ content: "Плейлист **" + name + "** уже существует. Выбери другое имя.", ephemeral: true });
          return;
        }
        logger.warn("Music queue playlist save failed", {
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          error: message
        });
        await interaction.reply({ content: "Не удалось сохранить текущую очередь.", ephemeral: true });
        return;
      }

      await interaction.reply({
        content: "💾 Очередь сохранена в **" + name + "**: **" + tracks.length + "** трек(ов).",
        ephemeral: true
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("dsp:music:search:") && interaction.guild) {
      const parts = interaction.customId.split(":");
      const token = parts[3];
      const index = Number(parts[4]);
      if (!token) {
        await interaction.reply({ content: "Результаты поиска устарели или недоступны.", ephemeral: true });
        return;
      }
      const session = this.searchSessions.get(token);
      if (!session || session.guildId !== interaction.guild.id || session.userId !== interaction.user.id || session.expiresAt < Date.now() || !isValidMusicSearchSelection(index, session.tracks.length)) {
        await interaction.reply({ content: "Результаты поиска устарели или недоступны.", ephemeral: true });
        if (token) this.searchSessions.delete(token);
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const player = this.manager?.players.get(interaction.guild.id);
      if (!player || !canControlMusic(member?.voice.channelId ?? null, player.voiceChannelId, interaction.memberPermissions?.has("ManageGuild") ?? false)) {
        await interaction.reply({ content: "Выбор результата нужно подтверждать из того же голосового канала.", ephemeral: true });
        return;
      }

      const selected = session.tracks[index];
      if (!selected) {
        await interaction.reply({ content: "Результат больше недоступен.", ephemeral: true });
        return;
      }
      player.queue.add(selected);
      if (!player.playing) await player.play();
      await this.persistPlayer(player);
      await this.syncController(player);
      this.searchSessions.delete(token);
      await interaction.update({ content: "✅ Добавлено: **" + selected.info.title + "**", embeds: [], components: [] });
      return;
    }


    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:music:") || !interaction.guild) return;

    const player = this.manager?.players.get(interaction.guild.id);
    if (!player) {
      await interaction.reply({ content: "Музыка не запущена.", ephemeral: true });
      return;
    }

    const manageGuild = interaction.memberPermissions?.has("ManageGuild") ?? false;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!canControlMusic(member?.voice.channelId ?? null, player.voiceChannelId, manageGuild)) {
      await interaction.reply({
        content: "Управлять музыкой можно из того же голосового канала или с правом Manage Server.",
        ephemeral: true
      });
      return;
    }

    const action = interaction.customId.slice("dsp:music:".length);
    if (action === "save-queue") {
      const modal = new ModalBuilder()
        .setCustomId("dsp:music:save-queue")
        .setTitle("Сохранить текущую очередь");
      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Имя плейлиста")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true)
        .setPlaceholder("Например: Вечерний сет");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));
      await interaction.showModal(modal);
      return;
    }

    if (action === "filters") {
      await interaction.reply({
        content: "🎚️ Выбери фильтр или FX. Действия применяются к текущему треку сразу.",
        components: this.filterPalette(),
        ephemeral: true
      });
      return;
    }

    if (action.startsWith("filter:")) {
      const filterAction = action.slice("filter:".length);
      if (!isMusicFilterAction(filterAction)) {
        await interaction.reply({ content: "Неизвестный filter action.", ephemeral: true });
        return;
      }
      try {
        await this.applyFilterAction(player, filterAction);
        await this.persistPlayer(player);
        await this.syncController(player);
        await interaction.reply({
          content: "🎚️ Filter применён: **" + filterAction + "**.",
          ephemeral: true
        });
      } catch (error) {
        logger.warn("Music quick filter operation failed", {
          guildId: interaction.guild.id,
          action: filterAction,
          error: String(error)
        });
        await interaction.reply({
          content: "Не удалось применить этот filter на текущем Lavalink node.",
          ephemeral: true
        });
      }
      return;
    }

    let response = "";

    if (action === "pause") {
      if (player.paused) await player.resume();
      else await player.pause();
      response = player.paused ? "⏸️ Пауза." : "▶️ Продолжаю.";
    } else if (action === "skip") {
      await player.skip();
      response = "⏭️ Следующий трек.";
    } else if (action === "stop") {
      await player.stopPlaying();
      response = "⏹️ Стоп.";
    } else if (action === "shuffle") {
      if (player.queue.tracks.length < 2) {
        await interaction.reply({ content: "В очереди недостаточно треков для shuffle.", ephemeral: true });
        return;
      }
      await Promise.resolve(player.queue.shuffle());
      await this.persistPlayer(player);
      response = "🔀 Очередь перемешана.";
    } else if (action === "repeat") {
      const mode = nextMusicQueueRepeatMode(player.repeatMode);
      await player.setRepeatMode(mode);
      await this.persistPlayer(player);
      response = "🔁 Queue Loop: **" + (mode === "queue" ? "on" : "off") + "**";
    } else if (action === "loop-one") {
      const mode = player.repeatMode === "track" ? "off" : "track";
      await player.setRepeatMode(mode);
      await this.persistPlayer(player);
      response = "🔂 Loop One: **" + (mode === "track" ? "on" : "off") + "**";
    } else if (action === "seek-back" || action === "seek-forward") {
      const track = player.queue.current;
      if (!track) {
        await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
        return;
      }
      const durationMs = Math.max(0, Number(track.info.duration ?? 0));
      const basePosition = Math.max(0, Number(player.lastPosition ?? 0));
      const elapsed = player.paused
        ? 0
        : Math.max(0, Date.now() - Number(player.lastPositionChange ?? Date.now()));
      const currentPosition = basePosition + elapsed;
      const deltaMs = action === "seek-back" ? -15_000 : 30_000;
      const nextPosition = Math.max(0, Math.min(durationMs > 0 ? Math.max(0, durationMs - 1_000) : currentPosition + deltaMs, currentPosition + deltaMs));
      await player.seek(nextPosition);
      await this.persistPlayer(player);
      response = (deltaMs < 0 ? "⏪ " : "⏩ ") + Math.floor(nextPosition / 1000) + " сек.";
    } else if (action === "volume-down" || action === "volume-up") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!await this.canManageMusicMember(interaction.guild.id, member)) {
        await interaction.reply({ content: "Громкость изменяют пользователи с DJ-ролью или Manage Server.", ephemeral: true });
        return;
      }
      const delta = action === "volume-up" ? 10 : -10;
      const next = clampMusicVolume(player.volume + delta);
      await player.setVolume(next);
      await this.persistPlayer(player);
      response = `🔊 Громкость: **${next}**`;
    } else if (action === "queue") {
      const page = this.buildQueuePage(player, 0);
      await interaction.reply({
        content: page.content,
        components: page.components,
        ephemeral: true
      });
      return;
    } else if (action.startsWith("queue-page:")) {
      const pageNumber = Number(action.slice("queue-page:".length));
      if (!Number.isInteger(pageNumber) || pageNumber < 0) return;
      const page = this.buildQueuePage(player, pageNumber);
      await interaction.reply({
        content: page.content,
        components: page.components,
        ephemeral: true
      });
      return;
    } else {
      return;
    }

    await this.syncController(player);
    await interaction.reply({ content: response, ephemeral: true });
  }

  private async restoreResumedPlayers(nodeId: string, fetchedPlayers: unknown[]): Promise<void> {
    for (const item of fetchedPlayers) {
      if (!item || typeof item !== "object") continue;
      const data = item as {
        guildId?: unknown;
        volume?: unknown;
        paused?: unknown;
        track?: unknown;
        repeatMode?: unknown;
        filters?: unknown;
        state?: {
          connected?: unknown;
          position?: unknown;
          ping?: unknown;
        };
      };

      const guildId = typeof data.guildId === "string" ? data.guildId : null;
      if (!guildId || data.state?.connected !== true) {
        if (guildId) {
          await this.db.query(
            "DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
            [guildId, this.config.botIdentityId]
          );
        }
        continue;
      }

      const saved = await this.db.query<{
        voice_channel_id: string | null;
        text_channel_id: string | null;
        state: unknown;
      }>(
        "SELECT voice_channel_id,text_channel_id,state FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
        [guildId, this.config.botIdentityId]
      );
      const savedRow = saved.rows[0];
      if (!savedRow?.voice_channel_id) continue;

      let savedState: { repeatMode?: unknown } = {};
      try {
        if (savedRow.state && typeof savedRow.state === "object") {
          savedState = savedRow.state as { repeatMode?: unknown };
        }
      } catch {
        savedState = {};
      }

      const existing = this.manager?.players.get(guildId);
      const player = existing ?? this.manager?.createPlayer({
        guildId,
        voiceChannelId: savedRow.voice_channel_id,
        textChannelId: savedRow.text_channel_id ?? undefined,
        node: nodeId,
        volume: typeof data.volume === "number" ? data.volume : 100,
        selfDeaf: true
      });

      if (!player) continue;

      try {
        if (!player.connected) await player.connect();
        if (typeof data.volume === "number") await player.setVolume(data.volume);

        if (data.filters && typeof data.filters === "object") {
          player.filterManager.data = data.filters as typeof player.filterManager.data;
        }

        await player.queue.utils.sync(true, false);
        const repeatValue =
          typeof data.repeatMode === "string"
            ? data.repeatMode
            : typeof savedState.repeatMode === "string"
              ? savedState.repeatMode
              : null;
        if (repeatValue) {
          const repeatMode = normalizeMusicRepeatMode(repeatValue);
          if (repeatMode) await player.setRepeatMode(repeatMode);
        }

        if (data.track && typeof data.track === "object") {
          player.queue.current = this.manager!.utils.buildTrack(
            data.track as Parameters<LavalinkManager["utils"]["buildTrack"]>[0],
            player.queue.current?.requester ?? this.client?.user
          );
          if (player.queue.current) {
            this.lastPlayedTracks.set(guildId, player.queue.current);
          }
        }

        const position = typeof data.state?.position === "number" ? data.state.position : 0;
        player.lastPosition = Number.isFinite(position) && position >= 0 ? position : 0;
        player.lastPositionChange = Date.now();

        if (typeof data.state?.ping === "number") {
          player.ping.lavalink = data.state.ping;
        }

        player.paused = data.paused === true;
        player.playing = !player.paused && Boolean(data.track);
        await this.persistPlayer(player);
      } catch (error) {
        logger.warn("Failed to restore Lavalink player", {
          node: nodeId,
          guildId,
          error: String(error)
        });
      }
    }
  }

  private async autoplayEnabled(guildId: string): Promise<boolean> {
    const result = await this.db.query<{ autoplay: boolean }>(
      "SELECT autoplay FROM music_settings WHERE guild_id=$1",
      [guildId]
    );
    return result.rows[0]?.autoplay ?? false;
  }

  private async musicSettings(guildId: string): Promise<{ preferredTextChannelId: string | null; requestChannelId: string | null; defaultVolume: number; announceTrackStart: boolean; autoLeaveSeconds: number; twentyFourSeven: boolean; queueAccess: "everyone" | "dj" }> {
    const result = await this.db.query<{ preferred_text_channel_id: string | null; request_channel_id: string | null; default_volume: number; announce_track_start: boolean; auto_leave_seconds: number; twenty_four_seven: boolean; queue_access: "everyone" | "dj" }>(
      "SELECT preferred_text_channel_id,request_channel_id,default_volume,announce_track_start,auto_leave_seconds,twenty_four_seven,queue_access FROM music_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      preferredTextChannelId: row?.preferred_text_channel_id ?? null,
      requestChannelId: row?.request_channel_id ?? null,
      defaultVolume: Math.min(Math.max(Number(row?.default_volume ?? 100), 0), 200),
      announceTrackStart: row?.announce_track_start ?? true,
      autoLeaveSeconds: Math.min(Math.max(Number(row?.auto_leave_seconds ?? 30), 0), 86400),
      twentyFourSeven: row?.twenty_four_seven ?? false,
      queueAccess: row?.queue_access === "dj" ? "dj" : "everyone"
    };
  }

  private async preferredTextChannelId(guildId: string, fallback: string | null | undefined): Promise<string | undefined> {
    const settings = await this.musicSettings(guildId);
    const preferred = settings.requestChannelId ?? settings.preferredTextChannelId;
    if (preferred) {
      const channel = this.client?.guilds.cache.get(guildId)?.channels.cache.get(preferred);
      if (channel?.isTextBased() && "send" in channel) return preferred;
    }
    return fallback ?? undefined;
  }

  private async requestChannelId(guildId: string): Promise<string | null> {
    const settings = await this.musicSettings(guildId);
    const channelId = settings.requestChannelId;
    if (!channelId) return null;
    const channel = this.client?.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    return channel?.isTextBased() && "send" in channel ? channelId : null;
  }

  private async defaultVolume(guildId: string): Promise<number> {
    return (await this.musicSettings(guildId)).defaultVolume;
  }

  private async announceTrackStart(guildId: string): Promise<boolean> {
    return (await this.musicSettings(guildId)).announceTrackStart;
  }

  private cancelAutoLeave(guildId: string): void {
    const timer = this.autoLeaveTimers.get(guildId);
    if (timer) clearTimeout(timer);
    this.autoLeaveTimers.delete(guildId);
  }

  private async scheduleAutoLeave(player: Player): Promise<void> {
    this.cancelAutoLeave(player.guildId);
    const settings = await this.musicSettings(player.guildId);
    if (settings.twentyFourSeven || settings.autoLeaveSeconds <= 0 || !this.manager) return;
    const seconds = settings.autoLeaveSeconds;
    const timer = setTimeout(() => {
      const current = this.manager?.players.get(player.guildId);
      if (!current || current.queue.current || current.queue.tracks.length > 0) return;
      void current.destroy("Music idle timeout").catch((error) => {
        logger.warn("Music idle timeout destroy failed", { guildId: player.guildId, error: String(error) });
      });
    }, seconds * 1000);
    timer.unref();
    this.autoLeaveTimers.set(player.guildId, timer);
  }

  private async setTwentyFourSeven(guildId: string, enabled: boolean): Promise<void> {
    await this.db.query(
      "INSERT INTO music_settings(guild_id,twenty_four_seven) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET twenty_four_seven=EXCLUDED.twenty_four_seven,updated_at=now()",
      [guildId, enabled]
    );
    if (enabled) this.cancelAutoLeave(guildId);
  }

  private async setAutoplay(guildId: string, enabled: boolean): Promise<void> {
    await this.db.query(
      "INSERT INTO music_settings(guild_id,autoplay) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET autoplay=EXCLUDED.autoplay,updated_at=now()",
      [guildId, enabled]
    );
  }

  private async autoplayNext(player: Player, lastPlayedTrack: Track): Promise<void> {
    if (!await this.autoplayEnabled(player.guildId)) return;
    if (this.autoplayInFlight.has(player.guildId)) return;

    this.autoplayInFlight.add(player.guildId);
    try {
      const seed = `${lastPlayedTrack.info.author ?? ""} ${lastPlayedTrack.info.title ?? ""}`.trim();
      if (!seed) return;

      const result = await player.search(
        { query: seed, source: "ytsearch" },
        this.client?.user
      );

      const candidate = result.tracks.find(
        (track) => track.info.identifier !== lastPlayedTrack.info.identifier
      );
      if (!candidate) return;

      player.queue.add(candidate);
      await this.persistPlayer(player);
    } finally {
      this.autoplayInFlight.delete(player.guildId);
    }
  }

  private async persistPlayer(player: {
    guildId: string;
    voiceChannelId: string | null;
    textChannelId: string | null;
    toJSON(): unknown;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO music_players(
        guild_id,bot_identity_id,voice_channel_id,text_channel_id,state
      )
      VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(guild_id,bot_identity_id)
      DO UPDATE SET
        voice_channel_id=EXCLUDED.voice_channel_id,
        text_channel_id=EXCLUDED.text_channel_id,
        state=EXCLUDED.state,
        updated_at=now()`,
      [
        player.guildId,
        this.config.botIdentityId,
        player.voiceChannelId ?? null,
        player.textChannelId ?? null,
        JSON.stringify(player.toJSON())
      ]
    ).catch((error) => logger.warn("Failed to persist music player", { error: String(error) }));
  }

  private buildQueuePage(player: Player, requestedPage: number): {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const pageSize = 10;
    const total = player.queue.tracks.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Math.trunc(requestedPage), 0), totalPages - 1);
    const start = page * pageSize;
    const tracks = player.queue.tracks.slice(start, start + pageSize);
    const lines = tracks.map((track, index) => {
      const requester = typeof track.requester?.id === "string" ? " · <@" + track.requester.id + ">" : "";
      return `${start + index + 1}. **${track.info.title}** — ${track.info.author ?? "Unknown artist"}${requester}`;
    });

    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`dsp:music:queue-page:${Math.max(0, page - 1)}`)
        .setEmoji("⬅️")
        .setLabel("Назад")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`dsp:music:queue-page:${Math.min(totalPages - 1, page + 1)}`)
        .setEmoji("➡️")
        .setLabel("Дальше")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    return {
      content: lines.length
        ? `📋 **Очередь** · страница ${page + 1}/${totalPages} · треков: ${total}\n\n${lines.join("\n")}`
        : "📋 Очередь пуста.",
      components: total > 0 ? [components] : []
    };
  }

  private buildControllerComponents(player: Player): ActionRowBuilder<ButtonBuilder>[] {
    const repeat = player.repeatMode === "off" ? "🔁" : player.repeatMode === "track" ? "🔂" : "🔁";
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dsp:music:previous").setEmoji("⏮️").setLabel("Назад").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:pause").setEmoji(player.paused ? "▶️" : "⏸️").setLabel(player.paused ? "Продолжить" : "Пауза").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dsp:music:skip").setEmoji("⏭️").setLabel("Следующий").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:shuffle").setEmoji("🔀").setLabel("Shuffle").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:repeat").setEmoji(repeat).setLabel("Queue Loop").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:loop-one").setEmoji("🔂").setLabel("Loop One").setStyle(player.repeatMode === "track" ? ButtonStyle.Primary : ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dsp:music:stop").setEmoji("⏹️").setLabel("Стоп").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("dsp:music:seek-back").setEmoji("⏪").setLabel("15с").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:seek-forward").setEmoji("⏩").setLabel("30с").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:volume-down").setEmoji("🔉").setLabel("-10").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:volume-up").setEmoji("🔊").setLabel("+10").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dsp:music:queue").setEmoji("📋").setLabel("Очередь").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:lyrics").setEmoji("📜").setLabel("Текст").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:favorite").setEmoji("❤️").setLabel("В избранное").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:filters").setEmoji("🎚️").setLabel("Фильтры").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:save-queue").setEmoji("💾").setLabel("Сохранить").setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  private async syncController(player: Player): Promise<void> {
    if (!this.client || !player.textChannelId) return;

    const preferredChannelId = await this.preferredTextChannelId(player.guildId, player.textChannelId);
    if (preferredChannelId && preferredChannelId !== player.textChannelId) {
      player.textChannelId = preferredChannelId;
      await this.persistPlayer(player);
    }

    const channelId = player.textChannelId;
    if (!channelId) return;
    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) return;

    const stored = await this.db.query<{ controller_message_id: string | null }>(
      "SELECT controller_message_id FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
      [player.guildId,this.config.botIdentityId]
    );
    const storedId = stored.rows[0]?.controller_message_id ?? null;
    const current = player.queue.current;
    const queueLines = player.queue.tracks.slice(0,10).map((track,index) =>
      `${index + 1}. ${track.info.title} — ${track.info.author ?? "Unknown artist"}`
    );

    const embed = new EmbedBuilder()
      .setTitle("🎵 Vexa Music")
      .setDescription(current
        ? `**${current.info.title}**\n${current.info.author ?? "Unknown artist"}`
        : "Сейчас ничего не играет.")
      .addFields(
        ...(current ? [{ name: "Прогресс", value: formatTrackProgress(player, current), inline: true }] : []),
        { name: "Состояние", value: player.paused ? "⏸ Пауза" : "▶ Играет", inline: true },
        { name: "Повтор", value: player.repeatMode, inline: true },
        { name: "Громкость", value: String(player.volume), inline: true },
        ...(queueLines.length ? [{ name: "Очередь", value: queueLines.join("\n") }] : [])
      )
      .setTimestamp();

    const components = this.buildControllerComponents(player);

    if (storedId) {
      const existing = await channel.messages.fetch(storedId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components }).catch(() => undefined);
        return;
      }
    }

    const sent = await channel.send({ embeds: [embed], components }).catch(() => null);
    if (!sent) return;

    await this.db.query(
      "UPDATE music_players SET controller_message_id=$1,updated_at=now() WHERE guild_id=$2 AND bot_identity_id=$3",
      [sent.id,player.guildId,this.config.botIdentityId]
    ).catch(() => undefined);
  }

  private async announce(channelId: string | null | undefined, text: string): Promise<void> {
    if (!channelId || !this.client) return;
    const channel = this.client.channels.cache.get(channelId);
    if (channel?.isTextBased() && "send" in channel) {
      await channel.send(text).catch(() => undefined);
    }
  }
}


export function canControlMusic(
  memberVoiceChannelId: string | null,
  playerVoiceChannelId: string | null,
  manageGuild: boolean
): boolean {
  return manageGuild || (
    Boolean(memberVoiceChannelId) &&
    Boolean(playerVoiceChannelId) &&
    memberVoiceChannelId === playerVoiceChannelId
  );
}


export function formatTrackProgress(player: Player, track: Track | null): string {
  if (!track) return "—";
  const durationMs = Math.max(0, Number(track.info.duration ?? 0));
  const basePosition = Math.max(0, Number(player.lastPosition ?? 0));
  const elapsedMs = player.paused
    ? basePosition
    : basePosition + Math.max(0, Date.now() - Number(player.lastPositionChange ?? Date.now()));
  const safeElapsed = durationMs > 0 ? Math.min(elapsedMs, durationMs) : elapsedMs;
  const elapsed = Math.floor(safeElapsed / 1000);
  const total = Math.floor(durationMs / 1000);
  return total > 0
    ? "`" + formatDurationSeconds(elapsed) + " / " + formatDurationSeconds(total) + "`"
    : "`" + formatDurationSeconds(elapsed) + " / live`";
}

function formatDurationSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}
export function normalizeMusicRepeatMode(value: string): MusicRepeatMode | null {
  return value === "off" || value === "track" || value === "queue" ? value : null;
}

export function shouldAutoplayAfterQueueEnd(
  autoplayEnabled: boolean,
  repeatMode: MusicRepeatMode,
  queuedTrackCount: number
): boolean {
  return autoplayEnabled && repeatMode === "off" && queuedTrackCount === 0;
}

export function canFailoverMusicNode(
  failedNodeId: string,
  connectedNodeIds: readonly string[]
): boolean {
  return connectedNodeIds.some((nodeId) => nodeId !== failedNodeId);
}

export function musicNodeHealth(connectedNodeCount: number): "ready" | "degraded" {
  return connectedNodeCount > 0 ? "ready" : "degraded";
}
