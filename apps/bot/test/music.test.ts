import test from "node:test";
import assert from "node:assert/strict";
import {
  Music,
  buildMusicSearch,
  canControlMusic,
  isMusicFailoverDebugEvent,
  musicPlayerNodeId,
  musicNodeHealth,
  normalizeMusicRepeatMode,
  normalizeMusicFilterPreset,
  shouldRetainMusicPlayerState,
  musicResumePosition,
  hasPersistedMusicPlayback,
  createMusicRecoveryGate,
  normalizeMusicSearchProvider,
  shouldAutoplayAfterQueueEnd,
  buildMusicSearchCandidates,
  normalizeMusicQueuePosition,
  normalizeMusicQueueMove,
  selectMusicEnqueueTracks,
  MAX_MUSIC_ENQUEUE_TRACKS,
  adjustMusicVolume
} from "../src/modules/music.js";

test("music controls require the same voice channel unless Manage Server is granted", () => {
  assert.equal(canControlMusic("voice-1", "voice-1", false), true);
  assert.equal(canControlMusic("voice-1", "voice-2", false), false);
  assert.equal(canControlMusic(null, "voice-1", false), false);
  assert.equal(canControlMusic("voice-2", null, false), false);
  assert.equal(canControlMusic(null, "voice-1", true), true);
  assert.equal(canControlMusic("voice-2", "voice-1", true), true);
});

test("Music repeat mode validator accepts only supported modes", () => {
  assert.equal(normalizeMusicRepeatMode("off"), "off");
  assert.equal(normalizeMusicRepeatMode("track"), "track");
  assert.equal(normalizeMusicRepeatMode("queue"), "queue");
  assert.equal(normalizeMusicRepeatMode("loop"), null);
  assert.equal(normalizeMusicRepeatMode(""), null);
});

import { DebugEvents } from "lavalink-client";
import { shouldEmitSchedule } from "../src/modules/automation-engine.js";

test("Automation schedule is emitted once per minute", () => {
  assert.equal(shouldEmitSchedule(100, null), true);
  assert.equal(shouldEmitSchedule(100, 99), true);
  assert.equal(shouldEmitSchedule(100, 100), false);
});


test("Music autoplay activates only when the queue really ended and repeat is off", () => {
  assert.equal(shouldAutoplayAfterQueueEnd(true, "off", 0), true);
  assert.equal(shouldAutoplayAfterQueueEnd(false, "off", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "track", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "queue", 0), false);
  assert.equal(shouldAutoplayAfterQueueEnd(true, "off", 1), false);
});

test("Music node health is degraded only when every Lavalink node is unavailable", () => {
  assert.equal(musicNodeHealth(0), "degraded");
  assert.equal(musicNodeHealth(1), "ready");
  assert.equal(musicNodeHealth(2), "ready");
});




test("Music provider normalization supports the built-in Lavalink search sources", () => {
  assert.equal(normalizeMusicSearchProvider("auto"), "auto");
  assert.equal(normalizeMusicSearchProvider("YouTube"), "youtube");
  assert.equal(normalizeMusicSearchProvider("youtube_music"), "youtube_music");
  assert.equal(normalizeMusicSearchProvider("SoundCloud"), "soundcloud");
  assert.equal(normalizeMusicSearchProvider("spotify"), "spotify");
  assert.equal(normalizeMusicSearchProvider("yandex_music"), "yandex_music");
  assert.equal(normalizeMusicSearchProvider("Yandex_Music"), "yandex_music");
});

test("Music search builder preserves URLs, explicit prefixes and provider selection", () => {
  assert.deepEqual(buildMusicSearch("auto", "ytmsearch: Daft Punk"), { query: "ytmsearch: Daft Punk" });
  assert.deepEqual(buildMusicSearch("auto", "Daft Punk"), { query: "Daft Punk", source: "ytsearch" });
  assert.deepEqual(buildMusicSearch("youtube", "Daft Punk"), { query: "Daft Punk", source: "ytsearch" });
  assert.deepEqual(buildMusicSearch("youtube_music", "ytsearch: Daft Punk"), { query: "Daft Punk", source: "ytmsearch" });
  assert.deepEqual(buildMusicSearch("soundcloud", "Daft Punk"), { query: "Daft Punk", source: "scsearch" });
  assert.deepEqual(buildMusicSearch("spotify", "Daft Punk"), { query: "Daft Punk", source: "spsearch" });
  assert.deepEqual(buildMusicSearch("yandex_music", "Daft Punk"), { query: "Daft Punk", source: "ymsearch" });
  assert.deepEqual(buildMusicSearch("auto", "spsearch: Daft Punk"), { query: "spsearch: Daft Punk" });
  assert.deepEqual(buildMusicSearch("auto", "ymsearch: Daft Punk"), { query: "ymsearch: Daft Punk" });
  assert.deepEqual(buildMusicSearch("soundcloud", "https://soundcloud.com/example/track"), { query: "https://soundcloud.com/example/track", source: "https" });
  assert.deepEqual(
    buildMusicSearch("auto", "https://youtu.be/-CsjE_ILvnY?si=-ZVCk2EgFY9bSHFy"),
    { query: "https://www.youtube.com/watch?v=-CsjE_ILvnY", source: "https" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://www.youtube.com/watch?v=-CsjE_ILvnY&si=-ZVCk2EgFY9bSHFy"),
    { query: "https://www.youtube.com/watch?v=-CsjE_ILvnY" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://www.youtube.com/shorts/-CsjE_ILvnY?si=-ZVCk2EgFY9bSHFy"),
    { query: "https://www.youtube.com/watch?v=-CsjE_ILvnY" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://www.youtube.com/watch?v=-CsjE_ILvnY&list=PL1234567890&index=2&si=-ZVCk2EgFY9bSHFy"),
    { query: "https://www.youtube.com/watch?v=-CsjE_ILvnY&list=PL1234567890&index=2" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://open.spotify.com/track/0eG08cBeKk0mzykKjw4hcQ?si=example"),
    { query: "https://open.spotify.com/track/0eG08cBeKk0mzykKjw4hcQ?si=example" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://open.spotify.com/intl-de/track/0eG08cBeKk0mzykKjw4hcQ"),
    { query: "https://open.spotify.com/intl-de/track/0eG08cBeKk0mzykKjw4hcQ" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://music.yandex.ru/album/13886032/track/71663565"),
    { query: "https://music.yandex.ru/album/13886032/track/71663565" }
  );
  assert.deepEqual(
    buildMusicSearch("auto", "https://soundcloud.com/example/track"),
    { query: "https://soundcloud.com/example/track" }
  );

  assert.equal(buildMusicSearch("auto", "   "), null);
});


test("Music failover debug filtering covers migration success and failure events", () => {
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNode), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNodeFail), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNodeFailNoEligibleNode), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerDestroyFail), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.QueueEnded), false);
});


test("Music recovery gate suppresses duplicate per-guild recovery", () => {
  const gate = createMusicRecoveryGate();
  assert.equal(gate.enter("guild-1"), true);
  assert.equal(gate.enter("guild-1"), false);
  assert.equal(gate.enter("guild-2"), true);
  gate.leave("guild-1");
  assert.equal(gate.enter("guild-1"), true);
  gate.leave("guild-1");
  gate.leave("guild-2");
});

test("Music resume position advances only while playing and stays inside track duration", () => {
  assert.equal(musicResumePosition(30_000, 10_000, true, 120_000, 50_000), 30_000);
  assert.equal(musicResumePosition(30_000, 10_000, false, 120_000, 50_000), 70_000);
  assert.equal(musicResumePosition(119_500, 10_000, false, 120_000, 50_000), 119_000);
  assert.equal(musicResumePosition(-100, Number.NaN, false, 0, 1_000), 0);
});

test("Music failed Lavalink resume keeps durable player state when playback is still recoverable", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string) {
      queries.push(text);
      if (text.startsWith("SELECT state FROM music_players")) {
        return { rows: [{ state: { track: { encoded: "track" }, paused: false, state: { position: 5_000 } } }] } as { rows: T[] };
      }
      if (text.startsWith("SELECT data FROM music_queue_store")) {
        return { rows: [{ data: { tracks: [{ encoded: "queued" }] } }] } as { rows: T[] };
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    }
  } as unknown as import("../src/database.js").Database;

  const music = new Music(db, {} as never, {} as never);
  await (music as unknown as {
    restoreResumedPlayers: (nodeId: string, fetchedPlayers: unknown[]) => Promise<void>;
  }).restoreResumedPlayers("node-1", [{
    guildId: "guild-1",
    state: { connected: false }
  }]);

  assert.equal(
    queries.some((query) => query.startsWith("DELETE FROM music_players")),
    false
  );
});

test("Music persisted playback detection distinguishes active queue state from an empty snapshot", () => {
  assert.equal(hasPersistedMusicPlayback({ track: { encoded: "track" } }, null), true);
  assert.equal(hasPersistedMusicPlayback({ track: null }, { tracks: [{ info: { title: "Queued" } }] }), true);
  assert.equal(hasPersistedMusicPlayback({ track: null }, { queue: [{ info: { title: "Queued" } }] }), true);
  assert.equal(hasPersistedMusicPlayback({ track: null }, { tracks: [] }), false);
  assert.equal(hasPersistedMusicPlayback({ track: null }, null), false);
});

test("Music durable player state is retained when a destroyed player still has current or queued tracks", () => {
  assert.equal(
    shouldRetainMusicPlayerState({ queue: { current: { info: { title: "Current" } }, tracks: [] } }),
    true
  );
  assert.equal(
    shouldRetainMusicPlayerState({ queue: { current: null, tracks: [{ info: { title: "Queued" } }] } }),
    true
  );
  assert.equal(
    shouldRetainMusicPlayerState({ queue: { current: null, tracks: [] } }),
    false
  );
});

test("Music player node identity helper is safe for missing and invalid node metadata", () => {
  assert.equal(musicPlayerNodeId({ node: { id: "node-a" } }), "node-a");
  assert.equal(musicPlayerNodeId({ node: null }), null);
  assert.equal(musicPlayerNodeId({}), null);
  assert.equal(musicPlayerNodeId({ node: { id: "" } }), null);
});

test("Music auto search falls back across built-in text providers", () => {
  assert.deepEqual(
    buildMusicSearchCandidates("auto", "Daft Punk"),
    [
      { query: "Daft Punk", source: "ytsearch" },
      { query: "Daft Punk", source: "ytmsearch" },
      { query: "Daft Punk", source: "scsearch" }
    ]
  );
  assert.deepEqual(
    buildMusicSearchCandidates("auto", "ytmsearch: Daft Punk"),
    [{ query: "ytmsearch: Daft Punk" }]
  );
  assert.deepEqual(
    buildMusicSearchCandidates("soundcloud", "Daft Punk"),
    [{ query: "Daft Punk", source: "scsearch" }]
  );
});

test("Music queue selection keeps one search result and up to 100 playlist tracks", () => {
  assert.deepEqual(selectMusicEnqueueTracks(["a", "b", "c"], 2, false), ["a"]);
  assert.equal(
    selectMusicEnqueueTracks(Array.from({ length: 150 }, (_, i) => i), MAX_MUSIC_ENQUEUE_TRACKS, true).length,
    MAX_MUSIC_ENQUEUE_TRACKS
  );
  assert.equal(MAX_MUSIC_ENQUEUE_TRACKS, 100);
});

test("Music queue position helpers validate 1-based user positions", () => {
  assert.equal(normalizeMusicQueuePosition(1, 3), 0);
  assert.equal(normalizeMusicQueuePosition(3, 3), 2);
  assert.equal(normalizeMusicQueuePosition(0, 3), null);
  assert.equal(normalizeMusicQueuePosition(4, 3), null);
  assert.deepEqual(normalizeMusicQueueMove(1, 3, 3), { from: 0, to: 2 });
  assert.equal(normalizeMusicQueueMove(2, 2, 3), null);
  assert.equal(normalizeMusicQueueMove(1, 4, 3), null);
});

test("Music volume controls clamp to 0-200 while changing in integer steps", () => {
  assert.equal(adjustMusicVolume(100, -10), 90);
  assert.equal(adjustMusicVolume(100, 10), 110);
  assert.equal(adjustMusicVolume(5, -10), 0);
  assert.equal(adjustMusicVolume(195, 10), 200);
  assert.equal(adjustMusicVolume(Number.NaN, 10), 110);
});

test("Music filter preset validator accepts supported built-in filters", () => {
  for (const preset of ["off","nightcore","vaporwave","karaoke","rotation","tremolo","vibrato","lowpass"]) {
    assert.equal(normalizeMusicFilterPreset(preset), preset);
  }
  assert.equal(normalizeMusicFilterPreset("bassboost"), null);
  assert.equal(normalizeMusicFilterPreset(""), null);
});
