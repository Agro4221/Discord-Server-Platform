import test from "node:test";
import assert from "node:assert/strict";
import { PlatformEventBus } from "../src/events.js";
import { Giveaways } from "../src/modules/giveaways.js";
import type { Database } from "../src/database.js";

test("giveaway participation buttons are wired to the platform interaction bus", async () => {
  const calls: string[] = [];
  const db = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.startsWith("UPDATE giveaways SET status='running'")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("UPDATE giveaways SET status='finished'")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT enabled FROM guild_modules")) {
        return { rows: [{ enabled: true }] };
      }
      if (sql.startsWith("INSERT INTO giveaway_entries")) {
        return { rows: [{ giveaway_id: "42" }] };
      }
      throw new Error("unexpected query");
    }
  } as unknown as Database;

  const events = new PlatformEventBus();
  const giveaways = new Giveaways(db);

  await giveaways.init({
    client: {} as never,
    db,
    events,
    auditLog: {} as never
  });

  let reply = "";
  const interaction = {
    isButton: () => true,
    customId: "dsp:giveaway:enter:42",
    guild: { id: "123456789012345678" },
    user: { id: "987654321098765432" },
    reply: async (payload: { content: string; ephemeral: boolean }) => {
      reply = payload.content;
    }
  };

  await events.emit("interaction", interaction as never);
  await giveaways.shutdown();

  assert.equal(reply, "Ты участвуешь! 🎉");
  assert.equal(calls.filter((sql) => sql.startsWith("SELECT enabled FROM guild_modules")).length, 1);
  assert.equal(calls.filter((sql) => sql.startsWith("INSERT INTO giveaway_entries")).length, 1);
});

test("giveaway participation is rejected atomically after the giveaway stops running", async () => {
  const db = {
    async query(sql: string) {
      if (sql.startsWith("SELECT enabled FROM guild_modules")) {
        return { rows: [{ enabled: true }] };
      }
      if (sql.startsWith("INSERT INTO giveaway_entries")) {
        return { rows: [] };
      }
      throw new Error("unexpected query");
    }
  } as unknown as Database;

  const events = new PlatformEventBus();
  const giveaways = new Giveaways(db);

  await giveaways.init({
    client: {} as never,
    db,
    events,
    auditLog: {} as never
  });

  let reply = "";
  const interaction = {
    isButton: () => true,
    customId: "dsp:giveaway:enter:43",
    guild: { id: "123456789012345678" },
    user: { id: "987654321098765432" },
    reply: async (payload: { content: string; ephemeral: boolean }) => {
      reply = payload.content;
    }
  };

  await events.emit("interaction", interaction as never);
  await giveaways.shutdown();

  assert.equal(reply, "Этот giveaway уже завершён или не найден.");
});
