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
  private directInteractionHandler?: (interaction: Interaction) => void;
  private manager?: LavalinkManager;
  private client?: Client;
  private initialized = false;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly identities: BotIdentityRepository
  ) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;

    if (this.config.botIdentityId !== "primary") {
      this.directInteractionHandler = (interaction) => {
        if (interaction.isChatInputCommand() && interaction.commandName === "music") {
          void this.onCommand(interaction);
        } else if (interaction.isButton() && interaction.customId.startsWith("dsp:music:")) {
          void this.onInteraction(interaction);
        }
      };
      this.client.on("interactionCreate", this.directInteractionHandler);
    }

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
          destroyAfterMs: 30_000
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
      void this.persistPlayer(player);
      if (!track) return;
      void this.announce(player.textChannelId, `🎵 Сейчас играет **${track.info.title}** — ${track.info.author}`);
    });

    this.manager.on("trackEnd", (player) => {
      void this.persistPlayer(player);
    });

    this.manager.on("queueEnd", (player) => {
      void this.persistPlayer(player);
    });

    this.manager.on("playerUpdate", (_oldPlayer, newPlayer) => {
      void this.persistPlayer(newPlayer);
    });

    this.manager.on("playerDestroy", (player) => {
      void this.db.query(
        "DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
        [player.guildId, this.config.botIdentityId]
      );
    });

    this.manager.nodeManager.on("connect", (node) => {
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
      if (!Array.isArray(fetchedPlayers)) return;
      void this.restoreResumedPlayers(node.id, fetchedPlayers as unknown[]);
    });

    this.manager.nodeManager.on("disconnect", (node, reason) => {
      logger.warn("Lavalink node disconnected", {
        node: node.id,
        reason: String(reason)
      });
    });

    this.manager.nodeManager.on("error", (node, error) => {
      logger.error("Lavalink node error", {
        node: node.id,
        error: String(error)
      });
    });

    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => {
      a();
      b();
    };
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

    if (this.client && this.directInteractionHandler) {
      this.client.off("interactionCreate", this.directInteractionHandler);
    }

    this.rawHandler = undefined;
    this.directInteractionHandler = undefined;
    this.readyHandler = undefined;
    this.manager = undefined;
    this.client = undefined;
    this.initialized = false;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "music") return;
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

    switch (interaction.options.getSubcommand()) {
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
      case "repeat":
        await this.repeat(interaction);
        break;
      case "autoplay":
        await this.autoplay(interaction);
        break;
      case "seek":
        await this.seek(interaction);
        break;
      case "queue":
        await this.queue(interaction);
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

    const player = this.getOrCreatePlayer(interaction, voiceChannelId);
    if (player.voiceChannelId !== voiceChannelId) {
      await interaction.reply({ content: "Музыкальный бот уже находится в другом голосовом канале этого сервера.", ephemeral: true });
      return;
    }

    if (!player.connected) {
      await player.connect();
    }

    const source = /^https?:\/\//i.test(query) ? undefined : "ytsearch";
    const result = await player.search(
      source ? { query, source } : { query },
      interaction.user
    );

    if (!result.tracks.length) {
      await interaction.reply({ content: "Ничего не найдено.", ephemeral: true });
      return;
    }

    player.queue.add(result.tracks[0]!);
    if (!player.playing) await player.play();

    await interaction.reply({
      content: `Добавлено в очередь: **${result.tracks[0]!.info.title}** — ${result.tracks[0]!.info.author}`,
      ephemeral: true
    });
  }

  private getOrCreatePlayer(
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
      textChannelId: interaction.channelId,
      volume: 100,
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
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Autoplay настраивается пользователями с Manage Server.", ephemeral: true });
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
      return this.config.botIdentityId === "primary";
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
    const allowed = canControlMusic(member?.voice.channelId ?? null, voiceChannelId, manageGuild);
    if (!allowed) {
      await interaction.reply({
        content: "Управлять музыкой можно из того же голосового канала или с правом Manage Server.",
        ephemeral: true
      });
    }
    return allowed;
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

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Менять громкость сервера могут пользователи с Manage Server.", ephemeral: true });
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

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dsp:music:pause").setLabel("Пауза").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("dsp:music:skip").setLabel("Следующий").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dsp:music:stop").setLabel("Стоп").setStyle(ButtonStyle.Danger)
    );

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

    await interaction.reply({ embeds: [embed], components: [row] });
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
    if (action === "pause") {
      if (player.paused) await player.resume();
      else await player.pause();
    }
    else if (action === "skip") await player.skip();
    else if (action === "stop") await player.stopPlaying();

    await interaction.reply({
      content:
        action === "pause" ? (player.paused ? "⏸️ Пауза." : "▶️ Продолжаю.") :
        action === "skip" ? "⏭️ Следующий трек." :
        "⏹️ Стоп.",
      ephemeral: true
    });
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
        if (typeof data.repeatMode === "string") {
          const repeatMode = normalizeMusicRepeatMode(data.repeatMode);
          if (repeatMode) await player.setRepeatMode(repeatMode);
        }

        if (data.track && typeof data.track === "object") {
          player.queue.current = this.manager!.utils.buildTrack(
            data.track as Parameters<LavalinkManager["utils"]["buildTrack"]>[0],
            player.queue.current?.requester ?? this.client?.user
          );
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

  private async setAutoplay(guildId: string, enabled: boolean): Promise<void> {
    await this.db.query(
      "INSERT INTO music_settings(guild_id,autoplay) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET autoplay=EXCLUDED.autoplay,updated_at=now()",
      [guildId, enabled]
    );
  }

  private async autoplayNext(player: Player, lastPlayedTrack: Track): Promise<void> {
    if (!await this.autoplayEnabled(player.guildId)) return;

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
