import { nextMusicQueueRepeatMode, nextMusicRepeatMode, clampMusicVolume, formatTrackProgress, trimMusicQueueToPosition } from "../src/modules/music.js";
import test from "node:test";
import assert from "node:assert/strict";
import { canControlMusic, canFailoverMusicNode, musicNodeHealth, normalizeMusicRepeatMode, shouldAutoplayAfterQueueEnd } from "../src/modules/music.js";

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

test("Music failover requires a different connected node", () => {
  assert.equal(canFailoverMusicNode("local", []), false);
  assert.equal(canFailoverMusicNode("local", ["local"]), false);
  assert.equal(canFailoverMusicNode("local", ["local-2"]), true);
  assert.equal(canFailoverMusicNode("local", ["local", "local-2"]), true);
});




test("Music repeat controller cycles through off, track and queue", () => {
  assert.equal(nextMusicRepeatMode("off"), "track");
  assert.equal(nextMusicRepeatMode("track"), "queue");
  assert.equal(nextMusicRepeatMode("queue"), "off");
});

test("Music volume controller clamps values to the Discord player range", () => {
  assert.equal(clampMusicVolume(-10), 0);
  assert.equal(clampMusicVolume(105), 105);
  assert.equal(clampMusicVolume(999), 200);
});

test("Music controller separates queue loop from Loop One", () => {
  assert.equal(nextMusicQueueRepeatMode("off"), "queue");
  assert.equal(nextMusicQueueRepeatMode("queue"), "off");
  assert.equal(nextMusicQueueRepeatMode("track"), "queue");
});

test("Music progress formatter handles paused and live tracks", () => {
  const track = { info: { duration: 125000 } } as never;
  const pausedPlayer = { paused: true, lastPosition: 65000, lastPositionChange: Date.now() - 5000 } as never;
  assert.equal(formatTrackProgress(pausedPlayer, track), "`1:05 / 2:05`");

  const liveTrack = { info: { duration: 0 } } as never;
  const livePlayer = { paused: true, lastPosition: 5000 } as never;
  assert.equal(formatTrackProgress(livePlayer, liveTrack), "`0:05 / live`");
});

test("Music skip-to keeps the selected queued track at the front", () => {
  const queue = ["one", "two", "three"];
  const target = trimMusicQueueToPosition(queue, 2);
  assert.equal(target, "two");
  assert.deepEqual(queue, ["two", "three"]);
  assert.equal(trimMusicQueueToPosition(queue, 0), null);
  assert.deepEqual(queue, ["two", "three"]);
});


test("music search selection accepts only existing result indexes", async () => {
  const { isValidMusicSearchSelection } = await import("../src/modules/music.js");
  assert.equal(isValidMusicSearchSelection(0, 5), true);
  assert.equal(isValidMusicSearchSelection(4, 5), true);
  assert.equal(isValidMusicSearchSelection(-1, 5), false);
  assert.equal(isValidMusicSearchSelection(5, 5), false);
  assert.equal(isValidMusicSearchSelection(1.5, 5), false);
});


test("music queue export contains safe track metadata", async () => {
  const { buildMusicQueueExport, buildMusicQueueShare } = await import("../src/modules/music.js");
  const tracks = [
    {
      info: {
        identifier: "abc",
        title: "Song",
        author: "Artist",
        duration: 123000,
        uri: "https://youtube.com/watch?v=abc"
      },
      requester: { id: "123456789012345678" }
    }
  ] as never;

  const payload = JSON.parse(buildMusicQueueExport(tracks)) as {
    schemaVersion: number;
    tracks: Array<Record<string, unknown>>;
  };
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.tracks[0]?.title, "Song");
  assert.equal(payload.tracks[0]?.requesterId, "123456789012345678");
  assert.equal(payload.tracks[0]?.secret, undefined);

  const shared = buildMusicQueueShare(tracks);
  assert.match(shared, /Song/);
  assert.match(shared, /Artist/);
  assert.match(shared, /youtube\.com/);
});

test("music queue share truncates safely for long queues", async () => {
  const { buildMusicQueueShare } = await import("../src/modules/music.js");
  const tracks = Array.from({ length: 100 }, (_, index) => ({
    info: {
      identifier: "id-" + index,
      title: "Very long track title " + index + " ".repeat(15),
      author: "Artist"
    }
  })) as never;

  const shared = buildMusicQueueShare(tracks);
  assert.equal(shared.length <= 1900, true);
  assert.match(shared, /используй|export/i);
});


test("music quick filter actions allow only known presets", async () => {
  const { isMusicFilterAction } = await import("../src/modules/music.js");
  for (const action of [
    "clear",
    "bassboost-low",
    "bassboost-medium",
    "bassboost-high",
    "rock",
    "classic",
    "pop",
    "electronic",
    "fullsound",
    "gaming",
    "nightcore",
    "8d"
  ]) {
    assert.equal(isMusicFilterAction(action), true, action);
  }
  for (const action of ["unknown", "volume", "seek"]) {
    assert.equal(isMusicFilterAction(action), false, action);
  }
});


test("music playlist names normalize whitespace and reject blanks", async () => {
  const { normalizeMusicPlaylistName } = await import("../src/modules/music.js");
  assert.equal(normalizeMusicPlaylistName("  Evening   Set  "), "Evening Set");
  assert.equal(normalizeMusicPlaylistName(""), null);
  assert.equal(normalizeMusicPlaylistName("   "), null);
  assert.equal(normalizeMusicPlaylistName("x".repeat(100))?.length, 80);
});


test("music playlist shuffle returns a copy without mutating source", async () => {
  const { shuffleMusicItems } = await import("../src/modules/music.js");
  const source = [1, 2, 3, 4, 5];
  const shuffled = shuffleMusicItems(source);
  assert.notEqual(shuffled, source);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), source);
});
