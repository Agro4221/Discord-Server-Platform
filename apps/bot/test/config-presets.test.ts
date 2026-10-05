import test from "node:test";
import assert from "node:assert/strict";
import { normalizePresetName } from "../src/config-presets.js";

test("server preset names are normalized and bounded", () => {
  assert.equal(normalizePresetName("  Production   Night  "), "Production Night");
  assert.throws(() => normalizePresetName(""), /invalid_preset_name/);
  assert.throws(() => normalizePresetName(" ".repeat(81)), /invalid_preset_name/);
  assert.throws(() => normalizePresetName(123), /invalid_preset_name/);
});
