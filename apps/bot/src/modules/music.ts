import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

type MusicRepeatMode = "off" | "track" | "queue";

const MAX_PLAYLIST_TRACKS = 500;

export function nextMusicRepeatMode(mode: MusicRepeatMode): MusicRepeatMode {
  if (mode === "off") return "track";
  if (mode === "track") return "queue";
  return "off";
}

export function clampMusicVolume(value: number): number {
  return Math.min(200, Math.max(0, Math.round(value)));
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
    });

    this.manager.nodeManager.on("destroy", (node) => {
      this.connectedNodes.delete(node.id);
      this.publishNodeHealth();
      logger.warn("Lavalink node destroyed", {
        node: node.id
      });
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
        title: track.info.title,
        author: track.info.author ?? "Unknown artist",
        durationMs: Number(track.info.duration ?? 0)
      })),
      nodeCount: this.connectedNodes.size
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

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return;
    const directAliases = new Set([
      "play", "pause", "resume", "skip", "stop", "shuffle",
      "playlist", "queue", "repeat", "seek", "volume", "autoplay", "nowplaying"
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
      case "pause":
        await this.pause(interaction, true);
        break;
      case "resume":
        await this.pause(interaction, false);
        break;
      case "skip":
        await this.skip(interaction);
        break;
      case "stop":
        await this.stop(interaction);
        break;
      case "shuffle":
        await this.shuffle(interaction);
        break;
      case "playlist":
      case "queue":
        await this.queue(interaction);
        break;
      case "repeat":
        await this.repeat(interaction);
        break;
      case "autoplay":
        await this.autoplay(interaction);
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
    }
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

  private async queueQuery(
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    query: string,
    requester: import("discord.js").User
  ): Promise<{ added: number; truncated: boolean; firstTitle: string; firstAuthor: string }> {
    if (!this.manager) throw new Error("music_manager_unavailable");

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

  private async queue(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.manager?.players.get(interaction.guildId!);
    if (!player) {
      await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
      return;
    }

    const tracks = player.queue.tracks.slice(0, 15);
    const lines = tracks.map((track, index) =>
      `${index + 1}. **${track.info.title}** — ${track.info.author}`
    );

    await interaction.reply({
      content: lines.length ? `📋 **Очередь**\n${lines.join("\n")}` : "Очередь пуста.",
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
      "play", "pause", "resume", "skip", "stop", "shuffle",
      "queue", "nowplaying", "repeat", "seek", "volume", "autoplay"
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
    } else if (action === "queue") {
      const tracks = player.queue.tracks.slice(0, 15);
      const lines = tracks.map((track, index) => (index + 1) + ". **" + track.info.title + "** — " + track.info.author);
      const embed = new EmbedBuilder()
        .setTitle("🎶 Playlist / Queue")
        .setDescription(lines.length ? lines.join("\n") : "Очередь пуста.")
        .setFooter({ text: message.guild.name })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
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
      const mode = nextMusicRepeatMode(player.repeatMode);
      await player.setRepeatMode(mode);
      await this.persistPlayer(player);
      response = `🔁 Repeat: **${mode}**`;
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
      const tracks = player.queue.tracks.slice(0, 15);
      const lines = tracks.map((track, index) => `${index + 1}. **${track.info.title}** — ${track.info.author ?? "Unknown artist"}`);
      response = lines.length ? `📋 Очередь\\n${lines.join("\\n")}` : "📋 Очередь пуста.";
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

  private async musicSettings(guildId: string): Promise<{ preferredTextChannelId: string | null; requestChannelId: string | null; defaultVolume: number; announceTrackStart: boolean; autoLeaveSeconds: number }> {
    const result = await this.db.query<{ preferred_text_channel_id: string | null; request_channel_id: string | null; default_volume: number; announce_track_start: boolean; auto_leave_seconds: number }>(
      "SELECT preferred_text_channel_id,request_channel_id,default_volume,announce_track_start,auto_leave_seconds FROM music_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      preferredTextChannelId: row?.preferred_text_channel_id ?? null,
      requestChannelId: row?.request_channel_id ?? null,
      defaultVolume: Math.min(Math.max(Number(row?.default_volume ?? 100), 0), 200),
      announceTrackStart: row?.announce_track_start ?? true,
      autoLeaveSeconds: Math.min(Math.max(Number(row?.auto_leave_seconds ?? 30), 0), 86400)
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
    const seconds = (await this.musicSettings(player.guildId)).autoLeaveSeconds;
    if (seconds <= 0 || !this.manager) return;
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

  private buildControllerComponents(player: Player): ActionRowBuilder<ButtonBuilder>[] {
    const repeat = player.repeatMode === "off" ? "🔁" : player.repeatMode === "track" ? "🔂" : "🔁";
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dsp:music:pause").setEmoji(player.paused ? "▶️" : "⏸️").setLabel(player.paused ? "Продолжить" : "Пауза").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dsp:music:skip").setEmoji("⏭️").setLabel("Следующий").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:shuffle").setEmoji("🔀").setLabel("Shuffle").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:repeat").setEmoji(repeat).setLabel("Repeat").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:stop").setEmoji("⏹️").setLabel("Стоп").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dsp:music:volume-down").setEmoji("🔉").setLabel("-10").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:volume-up").setEmoji("🔊").setLabel("+10").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dsp:music:queue").setEmoji("📋").setLabel("Очередь").setStyle(ButtonStyle.Secondary)
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

export function musicNodeHealth(connectedNodeCount: number): "ready" | "degraded" {
  return connectedNodeCount > 0 ? "ready" : "degraded";
}
