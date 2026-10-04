import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMusicSearch,
  canControlMusic,
  isMusicFailoverDebugEvent,
  musicPlayerNodeId,
  musicNodeHealth,
  normalizeMusicRepeatMode,
  shouldRetainMusicPlayerState,
  normalizeMusicSearchProvider,
  shouldAutoplayAfterQueueEnd
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
  assert.equal(normalizeMusicSearchProvider("spotify"), null);
});

test("Music search builder preserves URLs, explicit prefixes and provider selection", () => {
  assert.deepEqual(buildMusicSearch("auto", "ytmsearch: Daft Punk"), { query: "ytmsearch: Daft Punk" });
  assert.deepEqual(buildMusicSearch("auto", "Daft Punk"), { query: "Daft Punk", source: "ytsearch" });
  assert.deepEqual(buildMusicSearch("youtube", "Daft Punk"), { query: "Daft Punk", source: "ytsearch" });
  assert.deepEqual(buildMusicSearch("youtube_music", "ytsearch: Daft Punk"), { query: "Daft Punk", source: "ytmsearch" });
  assert.deepEqual(buildMusicSearch("soundcloud", "Daft Punk"), { query: "Daft Punk", source: "scsearch" });
  assert.deepEqual(buildMusicSearch("soundcloud", "https://soundcloud.com/example/track"), { query: "https://soundcloud.com/example/track" });
  assert.equal(buildMusicSearch("auto", "   "), null);
});


test("Music failover debug filtering covers migration success and failure events", () => {
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNode), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNodeFail), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerChangeNodeFailNoEligibleNode), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.PlayerDestroyFail), true);
  assert.equal(isMusicFailoverDebugEvent(DebugEvents.QueueEnded), false);
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
