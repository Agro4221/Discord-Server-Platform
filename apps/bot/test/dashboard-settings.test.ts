import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_SETTINGS } from "../src/dashboard-settings.js";

test("dashboard music schema exposes the persisted Autoplay / Radio profile", () => {
  const music = DASHBOARD_SETTINGS.find((item) => item.key === "music");
  assert.ok(music);

  const fields = new Map(music.fields.map((field) => [field.key, field]));
  assert.equal(fields.get("autoplay")?.type, "boolean");
  assert.equal(fields.get("radioEnabled")?.type, "boolean");
  assert.equal(fields.get("radioMode")?.type, "text");
  assert.equal(fields.get("radioMode")?.maxLength, 16);
  assert.equal(fields.get("radioSeed")?.type, "text");
  assert.equal(fields.get("radioSeed")?.maxLength, 200);
});
