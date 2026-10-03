import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_SETTINGS,
  DASHBOARD_SETTINGS_STORAGE
} from "../src/dashboard-settings.js";

test("every dashboard settings field has a persisted storage mapping", () => {
  for (const schema of DASHBOARD_SETTINGS) {
    const storage = DASHBOARD_SETTINGS_STORAGE[schema.key];
    assert.ok(storage, "Missing storage mapping for module " + schema.key);

    const schemaKeys = schema.fields.map((field) => field.key).sort();
    const storageKeys = Object.keys(storage.columns).sort();

    assert.deepEqual(
      storageKeys,
      schemaKeys,
      "Schema/storage field mismatch for module " + schema.key
    );
  }
});
