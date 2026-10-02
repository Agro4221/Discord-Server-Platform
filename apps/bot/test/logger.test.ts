import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeMeta } from "../src/logger.js";

test("structured logger redacts secret-like metadata recursively", () => {
  const safe = sanitizeMeta({
    user: { id: "123", password: "super-secret" },
    authorization: "Bearer token",
    nested: [{ apiKey: "secret-key" }],
    message: "ok"
  });

  assert.deepEqual(safe, {
    user: { id: "123", password: "[REDACTED]" },
    authorization: "[REDACTED]",
    nested: [{ apiKey: "[REDACTED]" }],
    message: "ok"
  });
});

test("structured logger bounds oversized strings and arrays", () => {
  const safe = sanitizeMeta({
    message: "x".repeat(5000),
    values: Array.from({ length: 150 }, (_, index) => index)
  });

  assert.match(String(safe.message), /truncated/);
  assert.equal((safe.values as unknown[]).length, 100);
});
