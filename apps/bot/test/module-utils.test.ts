import test from "node:test";
import assert from "node:assert/strict";
import { clearModuleEnabledCache, moduleEnabled } from "../src/module-utils.js";

test("moduleEnabled caches hot-path guild module reads for a short TTL", async () => {
  clearModuleEnabledCache();
  let calls = 0;
  const db = {
    async query() {
      calls += 1;
      return { rows: [{ enabled: true }] };
    }
  } as never;

  assert.equal(await moduleEnabled(db, "123456789012345678", "leveling"), true);
  assert.equal(await moduleEnabled(db, "123456789012345678", "leveling"), true);
  assert.equal(calls, 1);

  clearModuleEnabledCache("123456789012345678", "leveling");
  assert.equal(await moduleEnabled(db, "123456789012345678", "leveling"), true);
  assert.equal(calls, 2);
});

test("moduleEnabled keeps default behavior separate for empty rows", async () => {
  clearModuleEnabledCache();
  let calls = 0;
  const db = {
    async query() {
      calls += 1;
      return { rows: [] };
    }
  } as never;

  assert.equal(await moduleEnabled(db, "123456789012345679", "music", false), false);
  assert.equal(await moduleEnabled(db, "123456789012345679", "music", true), true);
  assert.equal(calls, 2);
});


test("moduleEnabled deduplicates concurrent cache misses", async () => {
  clearModuleEnabledCache();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const db = {
    async query() {
      calls += 1;
      await gate;
      return { rows: [{ enabled: true }] };
    }
  } as never;

  const first = moduleEnabled(db, "123456789012345680", "automod");
  const second = moduleEnabled(db, "123456789012345680", "automod");

  await Promise.resolve();
  assert.equal(calls, 1);
  release();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls, 1);
});
