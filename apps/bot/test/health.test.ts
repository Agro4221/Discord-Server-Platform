import test from "node:test";
import assert from "node:assert/strict";
import { HealthServer } from "../src/health.js";

test("health starts in a non-ready state", () => {
  const health = new HealthServer();
  const state = health.get();

  assert.equal(state.status, "starting");
  assert.equal(state.discord, "connecting");
  assert.equal(state.database, "connecting");
  assert.deepEqual(state.modules, {});
});

test("health state updates are preserved", () => {
  const health = new HealthServer();
  health.set({ status: "degraded", database: "down", lastError: "db failed" });
  health.setModule("temporary-voice", "ready");

  const state = health.get();
  assert.equal(state.status, "degraded");
  assert.equal(state.database, "down");
  assert.equal(state.lastError, "db failed");
  assert.equal(state.modules["temporary-voice"], "ready");
});
