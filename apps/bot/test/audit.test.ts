import test from "node:test";
import assert from "node:assert/strict";
import { AuditLog } from "../src/audit.js";

test("audit query applies source, action, actor and cursor filters safely", async () => {
  let captured = { text: "", values: [] as readonly unknown[] };
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      captured = { text, values };
      return { rows: [] as T[], rowCount: 0 };
    }
  } as unknown as import("../src/database.js").Database;

  const audit = new AuditLog(db);
  await audit.query("123456789012345678", {
    limit: 80,
    source: "dashboard",
    action: "forms.%published%",
    actorUserId: "234567890123456789",
    before: "2026-10-04T00:00:00.000Z"
  });

  assert.match(captured.text, /WHERE guild_id=\$1 AND source=\$2 AND action ILIKE \$3 ESCAPE '\\' AND actor_user_id=\$4 AND created_at < \$5/);
  assert.match(captured.text, /ORDER BY created_at DESC,id DESC/);
  assert.match(captured.text, /LIMIT \$6/);
  assert.deepEqual(captured.values, [
    "123456789012345678",
    "dashboard",
    "%forms.\\%published\\%%",
    "234567890123456789",
    "2026-10-04T00:00:00.000Z",
    80
  ]);
});

test("audit recent keeps the legacy bounded limit contract", async () => {
  let captured: readonly unknown[] = [];
  const db = {
    async query<T>(_text: string, values: readonly unknown[] = []) {
      captured = values;
      return { rows: [] as T[], rowCount: 0 };
    }
  } as unknown as import("../src/database.js").Database;

  await new AuditLog(db).recent("123456789012345678", 999);
  assert.equal(captured[captured.length - 1], 200);
});


test("audit module activity uses bounded action prefixes", async () => {
  let captured = { text: "", values: [] as readonly unknown[] };
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      captured = { text, values };
      return { rows: [] as T[], rowCount: 0 };
    }
  } as unknown as import("../src/database.js").Database;

  await new AuditLog(db).moduleActivity(
    "123456789012345678",
    "roles",
    40,
    "2026-10-05T00:00:00.000Z"
  );

  assert.match(captured.text, /WHERE guild_id=\$1/);
  assert.match(captured.text, /action ILIKE \$2 ESCAPE/);
  assert.match(captured.text, /action ILIKE \$3 ESCAPE/);
  assert.match(captured.text, /action ILIKE \$4 ESCAPE/);
  assert.match(captured.text, /created_at < \$5/);
  assert.match(captured.text, /LIMIT \$6/);
  assert.deepEqual(captured.values, [
    "123456789012345678",
    "role-panel.%",
    "role.%",
    "role_automation.%",
    "2026-10-05T00:00:00.000Z",
    40
  ]);
});
