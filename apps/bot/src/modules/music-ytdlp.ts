import {
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioResource,
  type VoiceConnection
} from "@discordjs/voice";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { VoiceChannel, StageChannel } from "discord.js";
import { logger } from "../logger.js";
import { NativeMusicResolver, type NativeMusicTrack } from "./music-resolver.js";

export type { NativeMusicTrack } from "./music-resolver.js";


type NativeMusicSession = {
  connection: VoiceConnection;
  player: AudioPlayer;
  current: NativeMusicTrack | null;
  volume: number;
  youtubeProcess?: ChildProcessWithoutNullStreams;
  ffmpegProcess?: ChildProcessWithoutNullStreams;
  generation: number;
  leaveTimer?: NodeJS.Timeout;
};



const DEFAULT_AUTO_LEAVE_MS = 30_000;

export class NativeYtdlpMusicBackend {
  private readonly sessions = new Map<string, NativeMusicSession>();

  private readonly resolver: NativeMusicResolver;

  constructor(
    private readonly ytDlpPath = process.env.YTDLP_PATH?.trim() || "yt-dlp",
    private readonly ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg",
    resolver?: NativeMusicResolver
  ) {
    this.resolver = resolver ?? new NativeMusicResolver(this.ytDlpPath);
  }

  async play(
    channel: VoiceChannel | StageChannel,
    query: string
  ): Promise<NativeMusicTrack> {
    const guildId = channel.guild.id;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("music_query_empty");

    const resolution = await this.resolver.resolve(normalizedQuery);
    const track = resolution.track;
    const session = await this.getOrCreateSession(channel);

    this.cancelLeave(session);
    this.stopProcesses(session);

    const generation = ++session.generation;
    const lookup = resolution.playbackQuery;

    const ytdlp = spawn(
      this.ytDlpPath,
      [
        "--quiet",
        "--no-warnings",
        "--no-playlist",
        "--no-progress",
        "--format",
        "bestaudio/best",
        "--output",
        "-",
        lookup
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    const ffmpeg = spawn(
      this.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        "pipe:0",
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-f",
        "s16le",
        "pipe:1"
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );

    session.youtubeProcess = ytdlp;
    session.ffmpegProcess = ffmpeg;
    session.current = track;

    ytdlp.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        logger.warn("Native Music yt-dlp", {
          guildId,
          title: track.title,
          message: message.slice(0, 1000)
        });
      }
    });

    ffmpeg.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        logger.warn("Native Music FFmpeg", {
          guildId,
          title: track.title,
          message: message.slice(0, 1000)
        });
      }
    });

    ytdlp.on("error", (error) => {
      if (session.generation !== generation) return;
      logger.error("Native Music yt-dlp process failed", {
        guildId,
        title: track.title,
        error: String(error)
      });
      if (session.player.state.status !== AudioPlayerStatus.Idle) {
        session.player.stop(true);
      }
    });

    ffmpeg.on("error", (error) => {
      if (session.generation !== generation) return;
      logger.error("Native Music FFmpeg process failed", {
        guildId,
        title: track.title,
        error: String(error)
      });
      if (session.player.state.status !== AudioPlayerStatus.Idle) {
        session.player.stop(true);
      }
    });

    ytdlp.on("close", (code, signal) => {
      if (session.generation !== generation) return;
      if (code !== 0 && session.player.state.status !== AudioPlayerStatus.Idle) {
        logger.warn("Native Music yt-dlp exited unexpectedly", {
          guildId,
          title: track.title,
          code,
          signal
        });
        session.player.stop(true);
      }
    });

    ffmpeg.on("close", (code, signal) => {
      if (session.generation !== generation) return;
      if (code !== 0 && session.player.state.status !== AudioPlayerStatus.Idle) {
        logger.warn("Native Music FFmpeg exited unexpectedly", {
          guildId,
          title: track.title,
          code,
          signal
        });
        session.player.stop(true);
      }
    });

    ytdlp.stdout.pipe(ffmpeg.stdin);

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track
    });

    resource.volume?.setVolume(session.volume / 100);
    session.player.play(resource);

    logger.info("Native Music playback started", {
      guildId,
      title: track.title,
      source: track.source,
      resolverProvider: resolution.provider,
      resolverStrategy: resolution.strategy,
      fallbackUsed: resolution.fallbackUsed,
      query: normalizedQuery,
      playbackQuery: lookup,
      voiceChannelId: channel.id
    });

    return track;
  }

  async pause(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    return session ? session.player.pause(true) : false;
  }

  async resume(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    return session ? session.player.unpause() : false;
  }

  async stop(guildId: string, disconnect = false): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    this.cancelLeave(session);
    this.stopProcesses(session);
    session.current = null;
    const stopped = session.player.stop(true);

    if (disconnect) {
      session.connection.destroy();
      this.sessions.delete(guildId);
    } else {
      this.scheduleLeave(guildId, session);
    }

    return stopped;
  }

  async setVolume(guildId: string, volume: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session || volume < 0 || volume > 200) return false;

    session.volume = volume;
    const resource = "resource" in session.player.state
      ? session.player.state.resource as AudioResource<NativeMusicTrack>
      : null;
    resource?.volume?.setVolume(volume / 100);
    return true;
  }

  getVolume(guildId: string): number {
    return this.sessions.get(guildId)?.volume ?? 100;
  }

  getCurrent(guildId: string): NativeMusicTrack | null {
    return this.sessions.get(guildId)?.current ?? null;
  }

  isPlaying(guildId: string): boolean {
    return this.sessions.get(guildId)?.player.state.status === AudioPlayerStatus.Playing;
  }

  isPaused(guildId: string): boolean {
    return this.sessions.get(guildId)?.player.state.status === AudioPlayerStatus.Paused;
  }

  getVoiceChannelId(guildId: string): string | null {
    const session = this.sessions.get(guildId);
    return session?.connection.joinConfig.channelId ?? null;
  }

  async shutdown(): Promise<void> {
    for (const [guildId, session] of this.sessions) {
      this.cancelLeave(session);
      this.stopProcesses(session);
      session.player.stop(true);
      session.connection.destroy();
      this.sessions.delete(guildId);
    }
  }

  private async getOrCreateSession(
    channel: VoiceChannel | StageChannel
  ): Promise<NativeMusicSession> {
    const guildId = channel.guild.id;
    const existing = this.sessions.get(guildId);

    if (existing && existing.connection.joinConfig.channelId !== channel.id) {
      this.cancelLeave(existing);
      this.stopProcesses(existing);
      existing.player.stop(true);
      existing.connection.destroy();
      this.sessions.delete(guildId);
    }

    const current = this.sessions.get(guildId);
    if (current) {
      await this.ensureReady(current.connection);
      return current;
    }

    const stale = getVoiceConnection(guildId);
    if (stale && stale.joinConfig.channelId !== channel.id) {
      stale.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    await this.ensureReady(connection);

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    connection.subscribe(player);

    const session: NativeMusicSession = {
      connection,
      player,
      current: null,
      volume: 100,
      generation: 0
    };

    player.on(AudioPlayerStatus.Idle, () => {
      session.youtubeProcess = undefined;
      session.ffmpegProcess = undefined;
      if (session.current) {
        logger.info("Native Music playback ended", {
          guildId,
          title: session.current.title
        });
        session.current = null;
      }
      this.scheduleLeave(guildId, session);
    });

    player.on("error", (error) => {
      logger.error("Native Music audio player error", {
        guildId,
        error: String(error)
      });
      this.stopProcesses(session);
    });

    connection.on("stateChange", (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.cancelLeave(session);
        this.stopProcesses(session);
        this.sessions.delete(guildId);
        return;
      }

      if (oldState.status !== newState.status) {
        logger.info("Native Music voice connection state changed", {
          guildId,
          from: oldState.status,
          to: newState.status,
          voiceChannelId: channel.id
        });
      }
    });

    this.sessions.set(guildId, session);
    return session;
  }

  private async ensureReady(connection: VoiceConnection): Promise<void> {
    if (connection.state.status === VoiceConnectionStatus.Ready) return;
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  }

  private stopProcesses(session: NativeMusicSession): void {
    const yt = session.youtubeProcess;
    const ffmpeg = session.ffmpegProcess;
    session.youtubeProcess = undefined;
    session.ffmpegProcess = undefined;

    if (yt && !yt.killed) yt.kill();
    if (ffmpeg && !ffmpeg.killed) ffmpeg.kill();
  }

  private scheduleLeave(guildId: string, session: NativeMusicSession): void {
    this.cancelLeave(session);
    session.leaveTimer = setTimeout(() => {
      if (session.player.state.status !== AudioPlayerStatus.Idle) return;
      if (session.current) return;
      session.connection.destroy();
      this.sessions.delete(guildId);
      logger.info("Native Music auto-left voice channel", { guildId });
    }, DEFAULT_AUTO_LEAVE_MS);
    session.leaveTimer.unref();
  }

  private cancelLeave(session: NativeMusicSession): void {
    if (session.leaveTimer) clearTimeout(session.leaveTimer);
    session.leaveTimer = undefined;
  }
}

