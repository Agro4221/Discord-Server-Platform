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

import { healthStatusCode, type HealthState } from "../src/health.js";

function state(overrides: Partial<HealthState> = {}): HealthState {
  return {
    status: "starting",
    startedAt: new Date().toISOString(),
    discord: "connecting",
    database: "connecting",
    modules: {},
    ...overrides
  };
}

test("/health is available after the database is ready even without Discord credentials", () => {
  assert.equal(
    healthStatusCode("/health", state({ database: "ready", status: "degraded", discord: "down" })),
    200
  );
});

test("/health stays unavailable while database startup is incomplete", () => {
  assert.equal(
    healthStatusCode("/health", state({ database: "connecting", status: "starting" })),
    503
  );
});

test("/ready remains strict and requires full ready state", () => {
  assert.equal(
    healthStatusCode("/ready", state({ database: "ready", status: "degraded", discord: "down" })),
    503
  );
  assert.equal(
    healthStatusCode("/ready", state({ database: "ready", status: "ready", discord: "ready" })),
    200
  );
});

test("unknown health paths remain 404", () => {
  assert.equal(healthStatusCode("/metrics", state()), 404);
});
