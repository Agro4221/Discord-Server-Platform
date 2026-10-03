import test from "node:test";
import assert from "node:assert/strict";
import { AutoMod, detectAutoModViolation, parseAutoModIdList } from "../src/modules/automod.js";

test("AutoMod configure sends every extended setting to PostgreSQL", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(_text: string, _values: readonly unknown[] = []) {
      queries.push({ text: _text, values: _values });
      if (_text.includes("SELECT enabled,blocked_words")) {
        return {
          rows: [{
            enabled: true,
            blocked_words: [],
            max_mentions: 6,
            max_caps_ratio: 0.85,
            max_repeated_messages: 5,
            repeated_window_seconds: 10,
            block_links: false,
            block_invites: false,
            max_links: 3,
            max_emojis: 20,
            max_line_length: 1000,
            exempt_channel_ids: "",
            exempt_role_ids: "",
            delete_message: true,
            timeout_minutes: 0
          }] as T[],
          rowCount: 1
        };
      }
      return { rows: [] as T[], rowCount: 1 };
    }
  } as unknown as import("../src/database.js").Database;

  const automod = new AutoMod(db);
  await automod.configure("guild-1", {
    blockedWords: ["spam"],
    blockLinks: true,
    blockInvites: true,
    maxLinks: 1,
    maxEmojis: 5,
    maxLineLength: 500,
    exemptChannelIds: "channel-1",
    exemptRoleIds: "role-1",
    timeoutMinutes: 10
  });

  const insert = queries.find((entry) => entry.text.includes("INSERT INTO automod_settings"));
  assert.ok(insert);
  assert.equal(insert.values.length, 16);
  assert.deepEqual(insert.values.slice(7, 14), [
    true,
    true,
    1,
    5,
    500,
    "channel-1",
    "role-1"
  ]);
  assert.equal(insert.values[15], 10);
});


test("AutoMod detector covers content, link, emoji, caps and repeat rules", () => {
  const config = {
    enabled: true,
    blockedWords: ["forbidden"],
    maxMentions: 2,
    maxCapsRatio: 0.8,
    maxRepeatedMessages: 3,
    repeatedWindowSeconds: 10,
    blockLinks: true,
    blockInvites: true,
    maxLinks: 2,
    maxEmojis: 2,
    maxLineLength: 20,
    exemptChannelIds: "",
    exemptRoleIds: "",
    deleteMessage: true,
    timeoutMinutes: 0
  };

  assert.equal(detectAutoModViolation("this is forbidden", 0, config), "blocked_word");
  assert.equal(detectAutoModViolation("hello", 3, config), "mention_spam");
  assert.equal(detectAutoModViolation("visit https://example.com", 0, config), "link_blocked");
  assert.equal(detectAutoModViolation("discord.gg/example", 0, config), "invite_link");
  assert.equal(
    detectAutoModViolation("https://a.test https://b.test https://c.test", 0, {
      ...config,
      blockLinks: false,
      blockInvites: false
    }),
    "link_spam"
  );
  assert.equal(detectAutoModViolation("😀😎🤖", 0, config), "emoji_spam");
  assert.equal(detectAutoModViolation("THIS IS A VERY LONG LINE", 0, config), "line_too_long");
  assert.equal(detectAutoModViolation("AAAAAAAAAAAA", 0, config), "excessive_caps");
  assert.equal(
    detectAutoModViolation("same", 0, config, ["same", "same", "same"]),
    "repeated_message"
  );
  assert.equal(detectAutoModViolation("normal message", 0, config), null);
});

test("AutoMod records a durable audit event for a handled violation", async () => {
  const auditEvents: unknown[] = [];
  const queries: string[] = [];
  const db = {
    async query<T>(text: string, _values: readonly unknown[] = []) {
      queries.push(text);
      if (text.startsWith("SELECT enabled FROM guild_modules")) {
        return { rows: [{ enabled: true }] } as { rows: T[] };
      }
      if (text.startsWith("SELECT enabled,blocked_words")) {
        return {
          rows: [{
            enabled: true,
            blocked_words: ["forbidden"],
            max_mentions: 6,
            max_caps_ratio: 0.85,
            max_repeated_messages: 5,
            repeated_window_seconds: 10,
            block_links: false,
            block_invites: false,
            max_links: 3,
            max_emojis: 20,
            max_line_length: 1000,
            exempt_channel_ids: "",
            exempt_role_ids: "",
            delete_message: false,
            timeout_minutes: 0
          }]
        } as { rows: T[] };
      }
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  const automod = new AutoMod(db);
  await automod.init({
    client: {} as never,
    db,
    events,
    auditLog: {
      record: async (event: unknown) => { auditEvents.push(event); }
    } as never,
    identityId: "primary"
  });

  const message = {
    id: "123456789012345678",
    guild: { id: "234567890123456789" },
    channelId: "345678901234567890",
    author: { id: "456789012345678901", bot: false },
    member: null,
    content: "this contains forbidden content",
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => undefined
  };

  await events.emit("message.create", message as never);
  await automod.shutdown();

  assert.equal(queries.some((query) => query.startsWith("INSERT INTO automod_events")), true);
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(auditEvents[0], {
    guildId: "234567890123456789",
    source: "system",
    action: "automod.violation",
    targetType: "user",
    targetId: "456789012345678901",
    metadata: {
      messageId: "123456789012345678",
      rule: "blocked_word",
      deleted: false,
      timedOut: false
    }
  });
});


test("AutoMod exemption parser accepts whitespace- and comma-separated IDs", () => {
  assert.deepEqual(
    [...parseAutoModIdList("channel-1, channel-2\nchannel-3\tchannel-4")],
    ["channel-1", "channel-2", "channel-3", "channel-4"]
  );
});


test("AutoMod rule upsert rejects unsupported detectors before database writes", async () => {
  let writes = 0;
  const db = {
    async query<T>(text: string, _values: readonly unknown[] = []) {
      if (/INSERT INTO|UPDATE|DELETE/i.test(text)) writes += 1;
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    }
  } as unknown as import("../src/database.js").Database;

  const automod = new AutoMod(db);
  await assert.rejects(
    () => automod.upsertRule("guild-1", { detector: "content" }),
    /unsupported_automod_detector/
  );
  assert.equal(writes, 0);
});
