import test from "node:test";
import assert from "node:assert/strict";
import { Tickets } from "../src/modules/tickets.js";
import { PlatformEventBus } from "../src/events.js";

test("Tickets performs stale closure recovery during initialization", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string) {
      queries.push(text);
      return { rows: [] as T[], rowCount: 0 };
    }
  } as unknown as import("../src/database.js").Database;

  const module = new Tickets(db);
  await module.init({
    client: {} as never,
    db,
    auditLog: {} as never,
    events: new PlatformEventBus(),
    identityId: "primary"
  });
  await module.shutdown();

  assert.equal(
    queries.some((query) => query.startsWith("UPDATE tickets SET status='open'")),
    true
  );
});

