import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocale, t } from "../src/localization.js";

test("localization supports RU and EN with Russian fallback", () => {
  assert.equal(normalizeLocale("ru"), "ru");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("de"), "ru");
  assert.equal(t("ru", "internal-error"), "Произошла внутренняя ошибка.");
  assert.equal(t("en", "internal-error"), "An internal error occurred.");
});

test("localized core messages keep stable keys", () => {
  assert.equal(t("ru", "help-empty"), "Нет доступных slash-команд.");
  assert.equal(t("en", "help-empty"), "No slash commands are available.");
  assert.equal(t("ru", "url-http"), "URL должен начинаться с http:// или https://.");
  assert.equal(t("en", "url-http"), "The URL must start with http:// or https://.");
});
