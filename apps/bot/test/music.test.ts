import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustMusicVolume,
  buildFfmpegArgs,
  buildFfmpegFilter,
  buildMusicSearchTarget,
  detectMusicSearchProvider,
  canControlMusic,
  musicPlayerNodeId,
  musicResumePosition,
  normalizeMusicFilterPreset,
  normalizeMusicQueueMove,
  normalizeMusicQueuePosition,
  normalizeMusicRepeatMode,
  nextMusicRepeatMode,
  normalizeMusicSearchProvider,
  normalizeMusicSourceUrl,
  normalizeYtDlpEntry,
  shouldAutoplayAfterQueueEnd,
  MAX_MUSIC_ENQUEUE_TRACKS
} from "../src/modules/music.js";

test("music controls require the same voice channel unless elevated", () => {
  assert.equal(canControlMusic("voice-1", "voice-1", false), true);
  assert.equal(canControlMusic("voice-1", "voice-2", false), false);
  assert.equal(canControlMusic(null, "voice-1", false), false);
  assert.equal(canControlMusic("voice-2", "voice-1", true), true);
});

test("Music repeat and provider validators accept only supported values", () => {
  assert.equal(normalizeMusicRepeatMode("off"), "off");
  assert.equal(normalizeMusicRepeatMode("track"), "track");
  assert.equal(normalizeMusicRepeatMode("queue"), "queue");
  assert.equal(normalizeMusicRepeatMode("loop"), null);
  assert.equal(nextMusicRepeatMode("off"), "track");
  assert.equal(nextMusicRepeatMode("track"), "queue");
  assert.equal(nextMusicRepeatMode("queue"), "off");
  assert.equal(normalizeMusicSearchProvider("auto"), "auto");
  assert.equal(normalizeMusicSearchProvider("YouTube"), "youtube");
  assert.equal(normalizeMusicSearchProvider("spotify"), "spotify");
  assert.equal(normalizeMusicSearchProvider("tiktok"), "tiktok");
  assert.equal(normalizeMusicSearchProvider("yandex_music"), "yandex_music");
  assert.equal(normalizeMusicSearchProvider("vk_music"), "vk_music");
  assert.equal(normalizeMusicSearchProvider("soundcloud"), "soundcloud");
  assert.equal(normalizeMusicSearchProvider("invalid"), null);
});

test("yt-dlp search targets cover supported text-search sources and direct URLs", () => {
  assert.equal(buildMusicSearchTarget("auto", "Daft Punk"), "ytsearch1:Daft Punk");
  assert.equal(buildMusicSearchTarget("youtube", "Daft Punk", 5), "ytsearch5:Daft Punk");
  assert.equal(buildMusicSearchTarget("soundcloud", "Daft Punk", 3), "scsearch3:Daft Punk");
  assert.equal(buildMusicSearchTarget("tiktok", "Daft Punk"), null);
  assert.equal(buildMusicSearchTarget("yandex_music", "Daft Punk"), null);
  assert.equal(buildMusicSearchTarget("vk_music", "Daft Punk"), null);
  assert.equal(buildMusicSearchTarget("spotify", "Daft Punk"), null);
  assert.equal(buildMusicSearchTarget("auto", " https://youtu.be/example "), "https://youtu.be/example");
  assert.equal(buildMusicSearchTarget("auto", "   "), null);
});

test("yt-dlp entries normalize into durable tracks", () => {
  assert.deepEqual(
    normalizeYtDlpEntry({ id: "abc", title: "Song", uploader: "Artist", duration: 12 }),
    {
      id: "abc",
      title: "Song",
      author: "Artist",
      durationMs: 12000,
      url: "https://www.youtube.com/watch?v=abc"
    }
  );
  assert.deepEqual(
    normalizeYtDlpEntry({ id: "yandex-id", title: "Song", uploader: "Artist", duration: 12, webpage_url: "https://music.yandex.ru/album/1/track/2" }),
    {
      id: "yandex-id",
      title: "Song",
      author: "Artist",
      durationMs: 12000,
      url: "https://music.yandex.ru/album/1/track/2"
    }
  );
  assert.deepEqual(
    normalizeYtDlpEntry({ id: "source-id", title: "Song", artist: "Artist", duration: 1 }, undefined, "https://www.tiktok.com/@artist/video/123"),
    {
      id: "source-id",
      title: "Song",
      author: "Artist",
      durationMs: 1000,
      url: "https://www.tiktok.com/@artist/video/123"
    }
  );
  assert.equal(normalizeYtDlpEntry(null), null);
});

test("music provider URLs are auto-detected", () => {
  assert.equal(detectMusicSearchProvider("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectMusicSearchProvider("https://www.tiktok.com/@artist/video/1"), "tiktok");
  assert.equal(detectMusicSearchProvider("https://music.yandex.ru/album/1/track/2"), "yandex_music");
  assert.equal(detectMusicSearchProvider("https://vk.com/audio123_456"), "vk_music");
  assert.equal(detectMusicSearchProvider("https://vk.ru/audio123_456_b741016853a7cbcc8b"), "vk_music");
  assert.equal(normalizeMusicSourceUrl("https://vk.ru/audio123_456_b741016853a7cbcc8b"), "https://vk.com/audio123_456_b741016853a7cbcc8b");
  assert.equal(detectMusicSearchProvider("https://open.spotify.com/track/abc"), "spotify");
  assert.equal(detectMusicSearchProvider("https://soundcloud.com/artist/track"), "soundcloud");
  assert.equal(detectMusicSearchProvider("https://example.com/video/1"), "auto");
  assert.equal(detectMusicSearchProvider("not-a-url"), null);
});

test("FFmpeg pipeline emits raw Discord PCM at 48 kHz stereo", () => {
  const args = buildFfmpegArgs("https://example.test/audio", 12_000, "lowpass");
  assert.deepEqual(args.slice(-9), ["-af", "lowpass=f=12000", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"]);
  assert.ok(args.includes("-ss"));
  assert.equal(buildFfmpegFilter("off"), null);
  assert.ok(buildFfmpegFilter("nightcore"));
});

test("Music queue helpers validate 1-based positions", () => {
  assert.equal(normalizeMusicQueuePosition(1, 3), 0);
  assert.equal(normalizeMusicQueuePosition(4, 3), null);
  assert.deepEqual(normalizeMusicQueueMove(1, 3, 3), { from: 0, to: 2 });
  assert.equal(normalizeMusicQueueMove(2, 2, 3), null);
});

test("Music autoplay activates only when the queue is empty and repeat is off", () => {
  assert.equal(shouldAutoplayAfterQueueEnd(true, "off", 0), true);
  assert.equal(shouldAutoplayAfterQueueEnd(false, "off", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "track", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "queue", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "off", 1), false);
});

test("Music resume position remains bounded by track duration", () => {
  assert.equal(musicResumePosition(30_000, 10_000, true, 120_000, 50_000), 30_000);
  assert.equal(musicResumePosition(30_000, 10_000, false, 120_000, 50_000), 70_000);
  assert.equal(musicResumePosition(119_500, 10_000, false, 120_000, 50_000), 119_000);
});

test("Music volume and engine identity helpers remain deterministic", () => {
  assert.equal(adjustMusicVolume(100, -10), 90);
  assert.equal(adjustMusicVolume(5, -10), 0);
  assert.equal(adjustMusicVolume(195, 10), 200);
  assert.equal(musicPlayerNodeId(true), "local");
  assert.equal(musicPlayerNodeId(false), null);
  assert.equal(MAX_MUSIC_ENQUEUE_TRACKS, 100);
});

test("Music filter validator accepts only supported FFmpeg filters", () => {
  assert.equal(normalizeMusicFilterPreset("off"), "off");
  assert.equal(normalizeMusicFilterPreset("nightcore"), "nightcore");
  assert.equal(normalizeMusicFilterPreset("bassboost"), null);
});
