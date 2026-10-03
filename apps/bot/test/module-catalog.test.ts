import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_SETTINGS } from "../src/dashboard-settings.js";
import { MODULE_CATALOG } from "../src/modules/catalog.js";

test("module catalog keys are unique", () => {
  const keys = MODULE_CATALOG.map((module) => module.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("dashboard setting keys are unique within a module", () => {
  for (const schema of DASHBOARD_SETTINGS) {
    const keys = schema.fields.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, schema.key);
  }
});


test("custom commands module is catalogued and enabled by default", () => {
  const custom = MODULE_CATALOG.find((module) => module.key === "custom-commands");
  assert.ok(custom);
  assert.equal(custom.defaultEnabled, true);
});
