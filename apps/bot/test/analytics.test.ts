import test from "node:test";
import assert from "node:assert/strict";
import { clearModuleEnabledCache } from "../src/module-utils.js";
import { Analytics } from "../src/modules/analytics.js";
import { PlatformEventBus } from "../src/events.js";

test("Analytics batches events from the same minute into one database write", async () => {
  clearModuleEnabledCache();

  const inserts: unknown[][] = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      if (text.startsWith("SELECT enabled FROM guild_modules")) {
        return { rows: [{ enabled: true }] } as { rows: T[] };
      }
      if (text.startsWith("INSERT INTO analytics_events")) {
        inserts.push([...values]);
        return { rows: [], rowCount: 1 } as { rows: T[] };
      }
      throw new Error("unexpected query: " + text);
    }
  } as never;

  const events = new PlatformEventBus();
  const analytics = new Analytics(db);

  await analytics.init({
    client: {} as never,
    db,
    events,
    auditLog: undefined,
    identityId: "primary"
  });

  const message = {
    guild: { id: "123456789012345678" },
    author: { bot: false }
  };

  await events.emit("message.create", message as never);
  await events.emit("message.create", message as never);
  await events.emit("message.create", message as never);

  await analytics.shutdown();

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.length, 4);
  assert.equal(inserts[0]?.[0], "123456789012345678");
  assert.equal(inserts[0]?.[1], "message");
  assert.equal(inserts[0]?.[3], 3);
});
