import { nextMusicQueueRepeatMode, nextMusicRepeatMode, clampMusicVolume, formatTrackProgress, trimMusicQueueToPosition, normalizeMusicRequestApprovalMode, normalizeMusicPlaylistVisibility, normalizeMusicPlaylistSearch, normalizeMusicPlaylistImportUrl, removeMusicPlaylistTrack, moveMusicPlaylistTrack } from "../src/modules/music.js";
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

test("Music playlist visibility normalizes to personal or shared", async () => {
  assert.equal(normalizeMusicPlaylistVisibility(false), "personal");
  assert.equal(normalizeMusicPlaylistVisibility(true), "shared");
});

test("Music request approval mode accepts only off or approval", () => {
  assert.equal(normalizeMusicRequestApprovalMode("off"), "off");
  assert.equal(normalizeMusicRequestApprovalMode("approval"), "approval");
  assert.equal(normalizeMusicRequestApprovalMode("APPROVAL"), null);
  assert.equal(normalizeMusicRequestApprovalMode("anything"), null);
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


test("Music playlist import URL accepts only HTTP(S)", () => {
  assert.equal(normalizeMusicPlaylistImportUrl("https://example.com/playlist?id=42"), "https://example.com/playlist?id=42");
  assert.equal(normalizeMusicPlaylistImportUrl(" http://example.com/list "), "http://example.com/list");
  assert.equal(normalizeMusicPlaylistImportUrl("ftp://example.com/list"), null);
  assert.equal(normalizeMusicPlaylistImportUrl("not a url"), null);
});

test("Music playlist search normalizes input", () => {
  assert.equal(normalizeMusicPlaylistSearch("  evening set  "), "evening set");
  assert.equal(normalizeMusicPlaylistSearch("   "), null);
  assert.equal(normalizeMusicPlaylistSearch("x".repeat(100))?.length, 80);
});

test("Music playlist track removal and movement preserve order", () => {
  const tracks = ["A", "B", "C", "D"];
  assert.deepEqual(removeMusicPlaylistTrack(tracks, 2), ["A", "C", "D"]);
  assert.deepEqual(removeMusicPlaylistTrack(tracks, 0), null);
  assert.deepEqual(removeMusicPlaylistTrack(tracks, 5), null);
  assert.deepEqual(moveMusicPlaylistTrack(tracks, 4, 2), ["A", "D", "B", "C"]);
  assert.deepEqual(moveMusicPlaylistTrack(tracks, 1, 4), ["B", "C", "D", "A"]);
  assert.deepEqual(moveMusicPlaylistTrack(tracks, 2, 2), ["A", "B", "C", "D"]);
  assert.deepEqual(moveMusicPlaylistTrack(tracks, 1, 5), null);
  assert.deepEqual(tracks, ["A", "B", "C", "D"]);
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


test("music vote skip threshold scales with human listeners", async () => {
  const { voteSkipThreshold } = await import("../src/modules/music.js");
  assert.equal(voteSkipThreshold(1), 1);
  assert.equal(voteSkipThreshold(2), 2);
  assert.equal(voteSkipThreshold(3), 2);
  assert.equal(voteSkipThreshold(5), 3);
  assert.equal(voteSkipThreshold(10), 6);
});


test("music request cooldown reports only positive remaining time", async () => {
  const { remainingMusicRequestCooldown } = await import("../src/modules/music.js");
  assert.equal(remainingMusicRequestCooldown(10_500, 10_000), 500);
  assert.equal(remainingMusicRequestCooldown(10_000, 10_500), 0);
  assert.equal(remainingMusicRequestCooldown(10_000, 10_000), 0);
});


test("music per-user queue limit helpers enforce bounds and available slots", async () => {
  const {
    normalizeMusicQueueLimit,
    countMusicQueuedByUser,
    remainingMusicQueueSlots
  } = await import("../src/modules/music.js");

  assert.equal(normalizeMusicQueueLimit(-5), 0);
  assert.equal(normalizeMusicQueueLimit(10.9), 10);
  assert.equal(normalizeMusicQueueLimit(999), 100);
  assert.equal(normalizeMusicQueueLimit(Number.NaN), 10);

  const tracks = [
    { requester: { id: "u1" } },
    { requester: { id: "u2" } },
    { requester: { id: "u1" } }
  ];
  assert.equal(countMusicQueuedByUser(tracks, "u1"), 2);
  assert.equal(countMusicQueuedByUser(tracks, "u3"), 0);
  assert.equal(remainingMusicQueueSlots(2, 10), 8);
  assert.equal(remainingMusicQueueSlots(10, 10), 0);
  assert.equal(remainingMusicQueueSlots(999, 0), null);
});


test("music guild queue size helpers enforce bounds and remaining capacity", async () => {
  const { normalizeMusicQueueSize, remainingMusicGuildQueueSlots } = await import("../src/modules/music.js");
  assert.equal(normalizeMusicQueueSize(-5), 0);
  assert.equal(normalizeMusicQueueSize(100.9), 100);
  assert.equal(normalizeMusicQueueSize(999), 500);
  assert.equal(normalizeMusicQueueSize(Number.NaN), 100);
  assert.equal(remainingMusicGuildQueueSlots(40, 100), 60);
  assert.equal(remainingMusicGuildQueueSlots(100, 100), 0);
  assert.equal(remainingMusicGuildQueueSlots(999, 0), null);
});


test("music autoplay controller toggle flips the persisted state target", async () => {
  const { toggleMusicAutoplay } = await import("../src/modules/music.js");
  assert.equal(toggleMusicAutoplay(false), true);
  assert.equal(toggleMusicAutoplay(true), false);
});


test("music vote-to-skip threshold scales with listeners and honors minimum", async () => {
  const { calculateMusicVoteSkipRequired } = await import("../src/modules/music.js");
  assert.equal(calculateMusicVoteSkipRequired(0, 0.5, 2), 2);
  assert.equal(calculateMusicVoteSkipRequired(1, 0.5, 2), 1);
  assert.equal(calculateMusicVoteSkipRequired(4, 0.5, 2), 2);
  assert.equal(calculateMusicVoteSkipRequired(9, 0.5, 2), 5);
  assert.equal(calculateMusicVoteSkipRequired(20, 0.2, 6), 6);
  assert.equal(calculateMusicVoteSkipRequired(20, 0.8, 2), 16);
});


test("Fair Queue rotates requester groups while preserving each requester's order", async () => {
  const { rebalanceMusicQueueByRequester } = await import("../src/modules/music.js");
  const tracks = [
    { id: "a1", requester: "A" },
    { id: "a2", requester: "A" },
    { id: "a3", requester: "A" },
    { id: "b1", requester: "B" },
    { id: "b2", requester: "B" }
  ];

  const result = rebalanceMusicQueueByRequester(
    tracks,
    (track) => track.requester
  );

  assert.deepEqual(result.map((track) => track.id), ["a1", "b1", "a2", "b2", "a3"]);
});

test("Fair Queue leaves a single requester unchanged", async () => {
  const { rebalanceMusicQueueByRequester } = await import("../src/modules/music.js");
  const tracks = [
    { id: "a1", requester: "A" },
    { id: "a2", requester: "A" }
  ];

  assert.deepEqual(
    rebalanceMusicQueueByRequester(tracks, (track) => track.requester).map((track) => track.id),
    ["a1", "a2"]
  );
});

test("Fair Queue keeps unknown requesters in their own rotation group", async () => {
  const { rebalanceMusicQueueByRequester } = await import("../src/modules/music.js");
  const tracks = [
    { id: "u1", requester: null },
    { id: "a1", requester: "A" },
    { id: "u2", requester: null },
    { id: "a2", requester: "A" }
  ];

  assert.deepEqual(
    rebalanceMusicQueueByRequester(tracks, (track) => track.requester).map((track) => track.id),
    ["u1", "a1", "u2", "a2"]
  );
});


test("music progress formatter clamps position and formats elapsed time", async () => {
  const { formatMusicProgress, formatMusicTime } = await import("../src/modules/music.js");
  assert.equal(formatMusicTime(0), "0:00");
  assert.equal(formatMusicTime(65_000), "1:05");
  assert.equal(formatMusicTime(3_661_000), "1:01:01");

  const full = formatMusicProgress(60_000, 120_000, 10);
  assert.equal(full, "━━━━━───── 1:00 / 2:00");

  const over = formatMusicProgress(999_000, 120_000, 10);
  assert.equal(over, "━━━━━━━━━━ 2:00 / 2:00");
});
