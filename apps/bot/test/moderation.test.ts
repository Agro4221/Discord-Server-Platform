import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { buildCommands } from "../src/discord/commands.js";
import { Moderation } from "../src/modules/moderation.js";

test("Moderation unlock clears the durable channel-lock record", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("SELECT previous_send_messages")) {
        return { rows: [{ previous_send_messages: true }] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 1 };
    }
  } as unknown as import("../src/database.js").Database;

  const edited: Array<boolean | null> = [];
  const moderation = new Moderation(db);
  const state = moderation as unknown as {
    client: {
      guilds: {
        cache: Map<string, {
          channels: { cache: Map<string, unknown> };
          members: { me: {
            permissions: { has: (permission: unknown) => boolean };
          } | null };
          roles: { everyone: unknown };
        }>;
      };
    };
  };
  state.client = {
    guilds: {
      cache: new Map([["guild-1", {
        channels: {
          cache: new Map([["123456789012345678", {
            type: 0,
            permissionsFor: () => ({ has: () => true }),
            permissionOverwrites: {
              edit: async (_role: unknown, permissions: { SendMessages: boolean | null }) => {
                edited.push(permissions.SendMessages);
              }
            }
          }]])
        },
        members: {
          me: {
            permissions: { has: () => true }
          }
        },
        roles: { everyone: {} }
      }]])
    }
  };

  const result = await moderation.dashboardChannelAction(
    "guild-1",
    "123456789012345678",
    "unlock"
  );

  assert.deepEqual(result, {
    action: "unlock",
    channelId: "123456789012345678"
  });
  assert.deepEqual(edited, [true]);
  assert.ok(queries.some((query) => query.text.startsWith("DELETE FROM moderation_channel_locks")));
});

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
