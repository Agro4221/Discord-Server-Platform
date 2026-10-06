import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeMusicFallbackQuery,
  buildNativeMusicSearchAttempts,
  detectNativeMusicProvider,
  isPlayableNativeMusicMetadata
} from "../src/modules/music-resolver.js";

test("native resolver detects the major direct-link providers", () => {
  assert.equal(detectNativeMusicProvider("https://youtu.be/test"), "youtube");
  assert.equal(detectNativeMusicProvider("https://music.youtube.com/watch?v=test"), "youtube_music");
  assert.equal(detectNativeMusicProvider("https://soundcloud.com/example/track"), "soundcloud");
  assert.equal(detectNativeMusicProvider("https://open.spotify.com/track/test"), "spotify");
  assert.equal(detectNativeMusicProvider("https://open.spotify.com/intl-de/track/test"), "spotify");
  assert.equal(detectNativeMusicProvider("https://music.yandex.ru/album/1/track/2"), "yandex_music");
  assert.equal(detectNativeMusicProvider("https://vk.com/video-1_2"), "vkontakte");
  assert.equal(detectNativeMusicProvider("https://vkvideo.ru/video-1_2"), "vkontakte");
  assert.equal(detectNativeMusicProvider("https://www.tiktok.com/@user/video/123"), "tiktok");
  assert.equal(detectNativeMusicProvider("https://example.com/audio.mp3"), "generic");
});

test("native text search uses actual yt-dlp search mechanisms", () => {
  assert.deepEqual(
    buildNativeMusicSearchAttempts("Daft Punk"),
    [
      { provider: "youtube", lookup: "ytsearch1:Daft Punk" },
      {
        provider: "youtube_music",
        lookup: "https://music.youtube.com/search?q=Daft%20Punk"
      },
      { provider: "soundcloud", lookup: "scsearch1:Daft Punk" }
    ]
  );
  assert.deepEqual(buildNativeMusicSearchAttempts("   "), []);
});

test("native resolver recognizes audio-capable metadata", () => {
  assert.equal(isPlayableNativeMusicMetadata({ url: "https://cdn.example/audio.mp3" }), true);
  assert.equal(
    isPlayableNativeMusicMetadata({
      formats: [
        { url: "https://cdn.example/video-only.mp4", vcodec: "h264", acodec: "none" },
        { url: "https://cdn.example/audio.opus", vcodec: "none", acodec: "opus" }
      ]
    }),
    true
  );
  assert.equal(
    isPlayableNativeMusicMetadata({
      formats: [{ url: "https://cdn.example/video-only.mp4", vcodec: "h264", acodec: "none" }]
    }),
    false
  );
  assert.equal(isPlayableNativeMusicMetadata({ title: "metadata only" }), false);
});

test("native metadata-only provider links produce a bounded artist/title fallback query", () => {
  assert.equal(
    buildNativeMusicFallbackQuery({
      artist: "Uroboros",
      title: "The Scooby Snacks (best part looped)"
    }),
    "Uroboros The Scooby Snacks (best part looped)"
  );
  assert.equal(
    buildNativeMusicFallbackQuery({
      uploader: "  Some   Artist  ",
      title: "  Some   Track  "
    }),
    "Some Artist Some Track"
  );
  assert.equal(buildNativeMusicFallbackQuery({ title: "" }), null);
});
