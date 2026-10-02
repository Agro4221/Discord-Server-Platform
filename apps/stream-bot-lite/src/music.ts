import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection
} from "@discordjs/voice";
import type { Guild, GuildMember } from "discord.js";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

type Track = {
  title: string;
  url: string;
  duration?: number;
  requestedBy: string;
};

type QueueState = {
  player: AudioPlayer;
  connection: VoiceConnection;
  items: Track[];
  current: Track | null;
  yt: ChildProcess | null;
  ffmpeg: ChildProcess | null;
  voiceChannelId: string;
  stopped: boolean;
  transitioning: boolean;
};

export class MusicService {
  private readonly queues = new Map<string, QueueState>();

  async checkDependencies(): Promise<void> {
    if (!ffmpegPath) {
      throw new Error("ffmpeg-static не смог найти бинарник для этой ОС.");
    }

    let result;
    try {
      result = await execFileAsync(
        config.ytdlpPath,
        ["--version"],
        { timeout: 10000, maxBuffer: 1024 * 1024 }
      );
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String((error as { code?: unknown }).code)
          : "";

      if (code === "ENOENT") {
        throw new Error(
          "yt-dlp не найден. На Windows запусти install.bat ещё раз: он скачает yt-dlp.exe автоматически."
        );
      }

      throw error;
    }

    console.log("[music] yt-dlp " + String(result.stdout).trim());
  }

  async play(
    guild: Guild,
    member: GuildMember,
    query: string
  ): Promise<Track> {
    const voiceChannel = member.voice.channel;

    if (!voiceChannel || voiceChannel.type !== 2) {
      throw new Error("Сначала зайди в обычный голосовой канал.");
    }

    const me = guild.members.me;
    if (!me) throw new Error("Бот ещё не готов.");

    const permissions = voiceChannel.permissionsFor(me);

    if (!permissions?.has(["Connect", "Speak"])) {
      throw new Error("Боту нужны права Connect и Speak.");
    }

    let queue = this.queues.get(guild.id);

    if (queue && queue.voiceChannelId !== voiceChannel.id) {
      throw new Error("Музыка уже играет в другом голосовом канале.");
    }

    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      const player = createAudioPlayer();
      connection.subscribe(player);

      queue = {
        player,
        connection,
        items: [],
        current: null,
        yt: null,
        ffmpeg: null,
        voiceChannelId: voiceChannel.id,
        stopped: false,
        transitioning: false
      };

      player.on(AudioPlayerStatus.Idle, () => {
        if (!queue || queue.stopped) return;
        this.cleanup(queue);
        queue.current = null;
        queue.transitioning = false;
        void this.playNext(guild.id).catch((error) => {
          console.error("[music]", error);
        });
      });

      player.on("error", (error) => {
        console.error("[music] player error", error);
        if (!queue || queue.stopped) return;
        this.cleanup(queue);
        queue.current = null;
        queue.transitioning = false;
        void this.playNext(guild.id).catch((nextError) => {
          console.error("[music]", nextError);
        });
      });

      this.queues.set(guild.id, queue);
    }

    const tracks = await this.resolve(query, member.displayName);
    queue.items.push(...tracks);

    if (!queue.current && !queue.transitioning) {
      await this.playNext(guild.id);
    }

    return tracks[0];
  }

  async skip(guildId: string): Promise<Track | null> {
    const queue = this.queues.get(guildId);
    if (!queue) return null;

    queue.transitioning = true;
    queue.current = null;
    this.cleanup(queue);
    queue.player.stop(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    queue.transitioning = false;

    await this.playNext(guildId);
    return queue.current;
  }

  pause(guildId: string): boolean {
    return this.queues.get(guildId)?.player.pause() ?? false;
  }

  resume(guildId: string): boolean {
    return this.queues.get(guildId)?.player.unpause() ?? false;
  }

  clearQueue(guildId: string): boolean {
    const queue = this.queues.get(guildId);
    if (!queue) return false;

    queue.items.length = 0;
    return true;
  }

  isPaused(guildId: string): boolean {
    return this.queues.get(guildId)?.player.state.status === AudioPlayerStatus.Paused;
  }

  stop(guildId: string): void {
    const queue = this.queues.get(guildId);
    if (!queue) return;

    queue.stopped = true;
    queue.items.length = 0;
    queue.current = null;
    this.cleanup(queue);
    queue.player.stop(true);
    queue.connection.destroy();
    this.queues.delete(guildId);
  }

  queue(guildId: string): { current: Track | null; items: Track[] } {
    const queue = this.queues.get(guildId);

    return {
      current: queue?.current ?? null,
      items: queue ? [...queue.items] : []
    };
  }

  async shutdown(): Promise<void> {
    for (const guildId of [...this.queues.keys()]) {
      this.stop(guildId);
    }
  }

  private async resolve(query: string, requestedBy: string): Promise<Track[]> {
    const isPlaylist =
      /^https?:\/\//i.test(query) &&
      /(youtube\.com\/playlist\?|[?&]list=)/i.test(query);

    const target = /^https?:\/\//i.test(query)
      ? query
      : "ytsearch1:" + query;

    if (isPlaylist) {
      const result = await execFileAsync(config.ytdlpPath, [
        target,
        "--flat-playlist",
        "--playlist-end", "50",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings"
      ], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000
      });

      const data = JSON.parse(String(result.stdout)) as {
        entries?: Array<{
          id?: string;
          title?: string;
          url?: string;
          webpage_url?: string;
          duration?: number;
        }>;
      };

      const entries = (data.entries ?? [])
        .filter((entry) => entry.id || entry.url || entry.webpage_url)
        .map((entry) => {
          const url =
            entry.webpage_url ||
            (entry.url && /^https?:\/\//i.test(entry.url)
              ? entry.url
              : entry.id
                ? "https://www.youtube.com/watch?v=" + encodeURIComponent(entry.id)
                : "");

          return {
            title: entry.title || "YouTube track",
            url,
            duration: entry.duration,
            requestedBy
          };
        })
        .filter((track) => track.url);

      if (!entries.length) {
        throw new Error("В YouTube-плейлисте не найдено доступных треков.");
      }

      return entries;
    }

    const result = await execFileAsync(config.ytdlpPath, [
      target,
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      "--skip-download"
    ], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000
    });

    const data = JSON.parse(String(result.stdout)) as {
      title?: string;
      webpage_url?: string;
      original_url?: string;
      duration?: number;
    };

    const url = data.webpage_url || data.original_url;

    if (!url || !data.title) {
      throw new Error("Не удалось найти аудио через yt-dlp.");
    }

    return [{
      title: data.title,
      url,
      duration: data.duration,
      requestedBy
    }];
  }

  private async playNext(guildId: string): Promise<void> {
    const queue = this.queues.get(guildId);

    if (!queue || queue.stopped || queue.current || queue.transitioning) {
      return;
    }

    const next = queue.items.shift();
    if (!next) return;

    queue.current = next;
    queue.transitioning = true;

    try {
      const yt: ChildProcess = spawn(config.ytdlpPath, [
        next.url,
        "-f", "bestaudio/best",
        "--no-playlist",
        "--no-warnings",
        "-o", "-"
      ], {
        stdio: ["ignore", "pipe", "ignore"]
      });

      if (!ffmpegPath) throw new Error("FFmpeg binary не найден.");

      const ffmpeg: ChildProcess = spawn(ffmpegPath, [
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
      ], {
        stdio: ["pipe", "pipe", "ignore"]
      });

      const ytStdout = yt.stdout;
      const ffmpegStdin = ffmpeg.stdin;
      const ffmpegStdout = ffmpeg.stdout;

      if (!ytStdout || !ffmpegStdin || !ffmpegStdout) {
        throw new Error("Не удалось открыть audio pipes.");
      }

      queue.yt = yt;
      queue.ffmpeg = ffmpeg;

      ytStdout.pipe(ffmpegStdin);

      yt.once("error", (error) => console.error("[music] yt-dlp", error));
      yt.once("close", (code) => {
        if (code !== 0) {
          console.error("[music] yt-dlp exited with", code);
        }
      });

      ffmpeg.once("error", (error) => console.error("[music] ffmpeg", error));
      ffmpeg.once("close", (code) => {
        if (code !== 0) {
          console.error("[music] ffmpeg exited with", code);
        }
      });

      const resource = createAudioResource(ffmpegStdout, {
        inputType: StreamType.Raw
      });

      queue.player.play(resource);
      queue.transitioning = false;
    } catch (error) {
      queue.transitioning = false;
      queue.current = null;
      this.cleanup(queue);
      throw error;
    }
  }

  private cleanup(queue: QueueState): void {
    for (const child of [queue.yt, queue.ffmpeg]) {
      if (child && !child.killed) child.kill();
    }

    queue.yt = null;
    queue.ffmpeg = null;
  }
}
