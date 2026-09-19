import test from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "../src/module-registry.js";
import type { PlatformModule } from "../src/module.js";

function module(name: string, shouldFail = false): PlatformModule {
  return {
    name,
    async init() {
      if (shouldFail) throw new Error("intentional");
    },
    async shutdown() {}
  };
}

test("module registry preserves registration order", () => {
  const registry = new ModuleRegistry();
  registry.register(module("a"));
  registry.register(module("b"));
  assert.deepEqual(registry.list(), ["a", "b"]);
});

test("one module failure degrades only that module", async () => {
  const registry = new ModuleRegistry();
  registry.register(module("broken", true));
  registry.register(module("healthy"));

  const result = await registry.initAll();
  assert.equal(result.broken, "degraded");
  assert.equal(result.healthy, "ready");
});
