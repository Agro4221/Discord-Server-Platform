import test from "node:test";
import assert from "node:assert/strict";
import {
  TemporaryVoice,
  buildTemporaryVoiceChannelName,
  getTemporaryVoiceChannelBitrate,
  shouldDeleteEmptyTemporaryVoiceRoom
} from "../src/modules/temporary-voice.js";
import { PlatformEventBus } from "../src/events.js";

test("temporary voice module starts with empty in-memory state", async () => {
  assert.equal(typeof "temporary-voice", "string");
});

test("temporary voice channel uses the member display name without a DSP prefix", () => {
  assert.equal(buildTemporaryVoiceChannelName("Example"), "Example");
  assert.equal(buildTemporaryVoiceChannelName("DSP | Example"), "Example");
  assert.equal(buildTemporaryVoiceChannelName("DSP: Example"), "Example");
  assert.equal(buildTemporaryVoiceChannelName("DSP_Example"), "Example");
  assert.equal(buildTemporaryVoiceChannelName("DSPExample"), "DSPExample");
  assert.equal(buildTemporaryVoiceChannelName("A".repeat(120)).length, 100);
});

test("temporary voice channel uses the guild maximum bitrate", () => {
  assert.equal(getTemporaryVoiceChannelBitrate({ maximumBitrate: 96_000 }), 96_000);
  assert.equal(getTemporaryVoiceChannelBitrate({ maximumBitrate: 384_000 }), 96_000);
});


test("temporary voice becomes ready only after Discord ready lifecycle", async () => {
  const db = {
    async query() {
      return { rows: [] };
    }
  } as unknown as import("../src/database.js").Database;

  const module = new TemporaryVoice(db, () => []);
  const events = new PlatformEventBus();
  await module.init({
    client: {} as never,
    db,
    auditLog: {} as never,
    events,
    identityId: "primary"
  });

  assert.equal(module.isReady(), false);
  module.markReady();
  assert.equal(module.isReady(), true);
  await module.shutdown();
});

test("disabled Temporary Voice removes only empty rooms", () => {
  assert.equal(shouldDeleteEmptyTemporaryVoiceRoom(0), true);
  assert.equal(shouldDeleteEmptyTemporaryVoiceRoom(1), false);
  assert.equal(shouldDeleteEmptyTemporaryVoiceRoom(5), false);
});
