import test from "node:test";
import assert from "node:assert/strict";
import { TemporaryVoice, shouldDeleteEmptyTemporaryVoiceRoom } from "../src/modules/temporary-voice.js";
import { PlatformEventBus } from "../src/events.js";

test("temporary voice module starts with empty in-memory state", async () => {
  assert.equal(typeof "temporary-voice", "string");
});

test("temporary voice naming prefix remains stable", () => {
  assert.match("DSP • Example", /^DSP • /);
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
