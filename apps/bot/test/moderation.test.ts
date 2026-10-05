import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { buildCommands } from "../src/discord/commands.js";
import { Moderation } from "../src/modules/moderation.js";

test("moderate slash command exposes unban", () => {
  const command = buildCommands().find((item) => item.name === "moderate");
  assert.ok(command);
  const json = command.toJSON();
  const options = Array.isArray(json.options) ? json.options : [];
  const unban = options.find((option) => option.name === "unban");
  assert.ok(unban);
  assert.deepEqual(
    (unban as { options?: Array<{ name: string; required?: boolean }> }).options?.map((item) => ({
      name: item.name,
      required: item.required
    })),
    [
      { name: "user", required: true },
      { name: "reason", required: true }
    ]
  );
});

test("Moderation unban applies Discord action and records a case", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string, _values: readonly unknown[] = []) {
      queries.push(text);
      if (text.includes("FROM guild_modules")) {
        return { rows: [{ enabled: true }] } as { rows: T[] };
      }
      if (text.includes("INSERT INTO moderation_cases")) {
        return { rows: [{ id: "42" }] } as { rows: T[] };
      }
      return { rows: [] as T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const moderation = new Moderation(db);
  const calls: unknown[] = [];
  const replies: unknown[] = [];
  const target = { id: "123456789012345678", tag: "user#0001" };

  const interaction = {
    guild: {
      id: "234567890123456789",
      name: "Test Guild",
      members: {
        unban: async (user: unknown, reason: string) => {
          calls.push({ user, reason });
          return user;
        }
      }
    },
    memberPermissions: {
      has: (permission: bigint) => permission === PermissionFlagsBits.BanMembers
    },
    user: { id: "345678901234567890" },
    reply: async (payload: unknown) => {
      replies.push(payload);
    }
  } as never;

  await moderation.unban(interaction, target as never, "cleanup");

  assert.deepEqual(calls, [{ user: target, reason: "cleanup" }]);
  assert.ok(queries.some((query) => query.includes("INSERT INTO moderation_cases")));
  assert.deepEqual(replies, [{
    content: "user#0001 разблокирован. Case #42.",
    ephemeral: true
  }]);
});


test("Moderation audit trail records notes and successful warnings", async () => {
  const queries: string[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const db = {
    async query<T>(text: string, _values: readonly unknown[] = []) {
      queries.push(text);
      if (text.includes("INSERT INTO moderation_notes")) {
        return { rows: [{ id: "7" }] } as { rows: T[] };
      }
      if (text.includes("INSERT INTO moderation_cases")) {
        return { rows: [{ id: "8" }] } as { rows: T[] };
      }
      return { rows: [] as T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const moderation = new Moderation(db);
  (moderation as unknown as {
    auditLog: { record: (event: Record<string, unknown>) => Promise<void> };
  }).auditLog = {
    record: async (event) => {
      auditEvents.push(event);
    }
  };

  await moderation.addNote(
    "234567890123456789",
    "123456789012345678",
    "345678901234567890",
    "important note"
  );

  const target = {
    id: "123456789012345678",
    tag: "user#0001",
    send: async () => undefined
  } as never;

  await (moderation as unknown as {
    applyWarn: (
      guildId: string,
      moderatorUserId: string,
      target: never,
      reason: string
    ) => Promise<void>;
  }).applyWarn(
    "234567890123456789",
    "345678901234567890",
    target,
    "spam"
  );

  assert.ok(queries.some((query) => query.includes("INSERT INTO moderation_notes")));
  assert.deepEqual(
    auditEvents.map((event) => ({
      action: event.action,
      targetType: event.targetType
    })),
    [
      { action: "moderation.note.added", targetType: "user" },
      { action: "moderation.warn.applied", targetType: "user" }
    ]
  );
});
