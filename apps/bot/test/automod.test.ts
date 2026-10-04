import test from "node:test";
import assert from "node:assert/strict";
import { AutoMod, clampAutoModWindowSeconds, detectAutoModViolation, detectorMatches, parseAutoModIdList } from "../src/modules/automod.js";

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

test("AutoMod rule windows are independent from the base detector window", () => {
  assert.equal(clampAutoModWindowSeconds(0), 1);
  assert.equal(clampAutoModWindowSeconds(5), 5);
  assert.equal(clampAutoModWindowSeconds(7200), 3600);
  assert.equal(clampAutoModWindowSeconds(Number.NaN), 10);

  const now = Date.now();
  const message = { content: "same" } as never;
  const config = {
    enabled: true,
    blockedWords: [],
    maxMentions: 6,
    maxCapsRatio: 0.85,
    maxRepeatedMessages: 5,
    repeatedWindowSeconds: 5,
    blockLinks: false,
    blockInvites: false,
    maxLinks: 3,
    maxEmojis: 20,
    maxLineLength: 1000,
    exemptChannelIds: "",
    exemptRoleIds: "",
    deleteMessage: true,
    timeoutMinutes: 0
  };

  assert.equal(
    detectorMatches(
      { detector: "repeated-text", threshold: 3, windowSeconds: 20 },
      message,
      [
        { content: "same", timestamp: now - 15_000 },
        { content: "same", timestamp: now - 10_000 },
        { content: "same", timestamp: now }
      ],
      config
    ),
    true
  );
});

test("AutoMod repeated-text rule honors its own window", () => {
  const now = Date.now();
  const message = { content: "same" } as never;
  const rule = { detector: "repeated-text", threshold: 3, windowSeconds: 5 };
  const config = {
    enabled: true,
    blockedWords: [],
    maxMentions: 6,
    maxCapsRatio: 0.85,
    maxRepeatedMessages: 5,
    repeatedWindowSeconds: 10,
    blockLinks: false,
    blockInvites: false,
    maxLinks: 3,
    maxEmojis: 20,
    maxLineLength: 1000,
    exemptChannelIds: "",
    exemptRoleIds: "",
    deleteMessage: true,
    timeoutMinutes: 0
  };

  assert.equal(
    detectorMatches(rule, message, [
      { content: "same", timestamp: now - 4_000 },
      { content: "same", timestamp: now - 2_000 },
      { content: "same", timestamp: now }
    ], config),
    true
  );
  assert.equal(
    detectorMatches(rule, message, [
      { content: "same", timestamp: now - 6_000 },
      { content: "same", timestamp: now - 4_000 },
      { content: "same", timestamp: now }
    ], config),
    false
  );
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




test("AutoMod timeout rule creates a moderation case only after Discord timeout succeeds", async () => {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const auditEvents: unknown[] = [];
  let timeoutMs = 0;

  const db = {
    async query<T>(text: string, queryValues: readonly unknown[] = []) {
      queries.push(text);
      values.push([...queryValues]);
      if (text.startsWith("SELECT enabled FROM guild_modules")) {
        return { rows: [{ enabled: true }] } as { rows: T[] };
      }
      if (text.startsWith("SELECT enabled,blocked_words")) {
        return { rows: [{
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
          delete_message: false,
          timeout_minutes: 0
        }] } as { rows: T[] };
      }
      if (text.includes("FROM automod_rules WHERE guild_id=")) {
        return { rows: [{
          detector: "honeypot",
          threshold: null,
          window_seconds: null,
          action: "timeout",
          timeout_minutes: 15,
          affected_role_ids: [],
          ignored_role_ids: [],
          affected_channel_ids: ["345678901234567890"],
          ignored_channel_ids: [],
          ignore_moderators: false,
          log_channel_id: null,
          message_template: ""
        }] } as { rows: T[] };
      }
      if (text.startsWith("INSERT INTO moderation_cases")) {
        return { rows: [{ id: "42" }] } as { rows: T[] };
      }
      return { rows: [], rowCount: 1 } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  const automod = new AutoMod(db);
  await automod.init({
    client: {} as never,
    db,
    events,
    auditLog: { record: async (event: unknown) => { auditEvents.push(event); } } as never,
    identityId: "primary"
  });

  const message = {
    id: "123456789012345678",
    guild: {
      id: "234567890123456789",
      channels: { cache: new Map() }
    },
    channelId: "345678901234567890",
    channel: { isTextBased: () => true, send: async () => undefined },
    author: { id: "456789012345678901", username: "tester", bot: false },
    member: {
      moderatable: true,
      roles: { cache: { map: () => [] } },
      timeout: async (duration: number) => { timeoutMs = duration; }
    },
    content: "trap message",
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => undefined
  };

  await events.emit("message.create", message as never);
  await automod.shutdown();

  assert.equal(timeoutMs, 15 * 60_000);
  assert.equal(queries.filter((query) => query.startsWith("INSERT INTO moderation_cases")).length, 1);
  const caseValues = values[values.findIndex((entry, index) => queries[index]?.startsWith("INSERT INTO moderation_cases") )] ?? [];
  assert.equal(caseValues[2], "timeout");
  assert.equal(caseValues[3], "AutoMod: honeypot");
  assert.ok(caseValues[4] instanceof Date);
  assert.equal((auditEvents[0] as { metadata?: { action?: string } })?.metadata?.action, "timeout");
});



test("AutoMod base timeout creates a moderation case after successful timeout", async () => {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const auditEvents: unknown[] = [];
  let timeoutMs = 0;
  const db = {
    async query<T>(text: string, queryValues: readonly unknown[] = []) {
      queries.push(text);
      values.push([...queryValues]);
      if (text.startsWith("SELECT enabled FROM guild_modules")) return { rows: [{ enabled: true }] } as { rows: T[] };
      if (text.startsWith("SELECT enabled,blocked_words")) {
        return { rows: [{
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
          timeout_minutes: 10
        }] } as { rows: T[] };
      }
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      if (text.startsWith("INSERT INTO moderation_cases")) return { rows: [{ id: "43" }] } as { rows: T[] };
      return { rows: [], rowCount: 1 } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  const automod = new AutoMod(db);
  await automod.init({
    client: {} as never,
    db,
    events,
    auditLog: { record: async (event: unknown) => { auditEvents.push(event); } } as never,
    identityId: "primary"
  });

  const message = {
    id: "123456789012345678",
    guild: { id: "234567890123456789" },
    channelId: "345678901234567890",
    channel: { isTextBased: () => true, send: async () => undefined },
    author: { id: "456789012345678901", username: "tester", bot: false },
    member: {
      moderatable: true,
      roles: { cache: { map: () => [] } },
      timeout: async (duration: number) => { timeoutMs = duration; }
    },
    content: "forbidden content",
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => undefined
  };

  await events.emit("message.create", message as never);
  await automod.shutdown();

  assert.equal(timeoutMs, 10 * 60_000);
  const index = queries.findIndex((query) => query.startsWith("INSERT INTO moderation_cases"));
  assert.notEqual(index, -1);
  assert.equal(values[index]?.[2], "AutoMod: blocked_word");
  assert.ok(values[index]?.[3] instanceof Date);
  assert.equal((auditEvents[0] as { metadata?: { timedOut?: boolean } })?.metadata?.timedOut, true);
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


test("AutoMod warn does not delete or timeout and always attempts a warning response", async () => {
  const deletes: string[] = [];
  const sent: string[] = [];
  let timeoutCalls = 0;
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const auditEvents: unknown[] = [];
  const moderationEvents: unknown[] = [];

  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      if (text.startsWith("INSERT INTO moderation_cases")) return { rows: [{ id: "77" }], rowCount: 1 } as { rows: T[] };
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  events.on("moderation.case", (event) => {
    moderationEvents.push(event);
  });

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
    author: { id: "456789012345678901", username: "tester", bot: false },
    member: {
      moderatable: true,
      timeout: async () => { timeoutCalls += 1; }
    },
    channel: {
      send: async (payload: { content: string }) => {
        sent.push(payload.content);
      }
    },
    delete: async () => { deletes.push("deleted"); }
  };

  await (automod as unknown as {
    applyRule: (
      message: unknown,
      rule: {
        detector: string;
        action: "delete" | "timeout" | "warn" | "log" | "ban";
        timeoutMinutes: number;
        logChannelId: string | null;
        messageTemplate: string;
      }
    ) => Promise<boolean>;
  }).applyRule(message, {
    detector: "blocked_word",
    action: "warn",
    timeoutMinutes: 30,
    logChannelId: null,
    messageTemplate: ""
  });

  await automod.shutdown();

  assert.deepEqual(deletes, []);
  assert.equal(timeoutCalls, 0);
  assert.deepEqual(sent, ["⚠️ <@456789012345678901>, AutoMod обнаружил нарушение **blocked_word**."]);
  assert.equal(queries.filter((item) => item.text.startsWith("INSERT INTO moderation_cases")).length, 1);
  assert.deepEqual(moderationEvents[0], {
    guildId: "234567890123456789",
    userId: "456789012345678901",
    action: "warn",
    caseId: 77
  });
  assert.equal(
    (auditEvents[0] as { metadata?: { action?: string; deleted?: boolean; timedOut?: boolean; responseDelivered?: boolean } })
      ?.metadata?.action,
    "warn"
  );
  assert.equal(
    (auditEvents[0] as { metadata?: { responseDelivered?: boolean } })?.metadata?.responseDelivered,
    true
  );
});

test("AutoMod warn keeps the moderation case when warning response delivery fails", async () => {
  const sentAttempts: string[] = [];
  const auditEvents: unknown[] = [];
  const moderationEvents: unknown[] = [];

  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      if (text.startsWith("INSERT INTO moderation_cases")) return { rows: [{ id: "88" }], rowCount: 1 } as { rows: T[] };
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  events.on("moderation.case", (event) => moderationEvents.push(event));

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
    id: "223456789012345678",
    guild: { id: "234567890123456789" },
    channelId: "345678901234567890",
    author: { id: "556789012345678901", username: "tester", bot: false },
    member: null,
    channel: {
      send: async () => {
        sentAttempts.push("attempted");
        throw new Error("response delivery failed");
      }
    },
    delete: async () => {
      throw new Error("warn must not delete");
    }
  };

  await (automod as unknown as {
    applyRule: (
      message: unknown,
      rule: {
        detector: string;
        action: "delete" | "timeout" | "warn" | "log";
        timeoutMinutes: number;
        logChannelId: string | null;
        messageTemplate: string;
      }
    ) => Promise<boolean>;
  }).applyRule(message, {
    detector: "blocked_word",
    action: "warn",
    timeoutMinutes: 0,
    logChannelId: null,
    messageTemplate: "⚠️ {mention}, warning"
  });

  await automod.shutdown();

  assert.deepEqual(sentAttempts, ["attempted"]);
  assert.deepEqual(moderationEvents[0], {
    guildId: "234567890123456789",
    userId: "556789012345678901",
    action: "warn",
    caseId: 88
  });
  assert.equal(
    (auditEvents[0] as { metadata?: { responseDelivered?: boolean } })?.metadata?.responseDelivered,
    false
  );
});

test("AutoMod log rules require a configured log channel", async () => {
  let writes = 0;
  const db = {
    async query<T>(text: string, _values: readonly unknown[] = []) {
      if (/INSERT INTO|UPDATE|DELETE/i.test(text)) writes += 1;
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    }
  } as unknown as import("../src/database.js").Database;

  const automod = new AutoMod(db);
  await assert.rejects(
    () => automod.upsertRule("guild-1", { detector: "honeypot", action: "log", logChannelId: null }),
    /automod_log_channel_required/
  );
  assert.equal(writes, 0);
});

test("AutoMod log rule can deliver a template to its configured log channel", async () => {
  const sent: unknown[] = [];
  const auditEvents: unknown[] = [];
  const db = {
    async query<T>(text: string) {
      if (text.startsWith("SELECT enabled FROM guild_modules")) return { rows: [{ enabled: true }] } as { rows: T[] };
      if (text.startsWith("SELECT enabled,blocked_words")) {
        return { rows: [{ enabled: true, blocked_words: [], max_mentions: 6, max_caps_ratio: 0.85, max_repeated_messages: 5, repeated_window_seconds: 10, block_links: false, block_invites: false, max_links: 3, max_emojis: 20, max_line_length: 1000, exempt_channel_ids: "", exempt_role_ids: "", delete_message: false, timeout_minutes: 0 }] } as { rows: T[] };
      }
      if (text.includes("FROM automod_rules WHERE guild_id=")) {
        return { rows: [{ detector: "honeypot", threshold: null, window_seconds: null, action: "log", timeout_minutes: 0, affected_role_ids: [], ignored_role_ids: [], affected_channel_ids: ["345678901234567890"], ignored_channel_ids: [], ignore_moderators: true, log_channel_id: "999999999999999999", message_template: "{mention} нарушил правило в {channel}" }] } as { rows: T[] };
      }
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      return { rows: [], rowCount: 1 } as { rows: T[] };
    }
  } as unknown as import("../src/database.js").Database;
  const events = new (await import("../src/events.js")).PlatformEventBus();
  const automod = new AutoMod(db);
  await automod.init({
    client: {} as never,
    db,
    events,
    auditLog: { record: async (event: unknown) => { auditEvents.push(event); } } as never,
    identityId: "primary"
  });
  const logChannel = {
    id: "999999999999999999",
    isTextBased: () => true,
    send: async (payload: unknown) => { sent.push(payload); }
  };
  const message = {
    id: "123456789012345678",
    guild: {
      id: "234567890123456789",
      channels: { cache: new Map([["999999999999999999", logChannel]]) }
    },
    channelId: "345678901234567890",
    channel: { isTextBased: () => true, send: async () => undefined },
    author: { id: "456789012345678901", username: "tester", bot: false },
    member: null,
    content: "trigger",
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => undefined
  };
  await events.emit("message.create", message as never);
  await automod.shutdown();
  assert.equal(sent.length, 1);
  assert.match(JSON.stringify(sent[0]), /нарушил правило/);
  assert.equal((auditEvents[0] as { metadata?: { logDelivered?: boolean } })?.metadata?.logDelivered, true);
});


test("AutoMod ban rule deletes the message and creates a case only after Discord ban succeeds", async () => {
  const deletes: string[] = [];
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const auditEvents: unknown[] = [];
  const moderationEvents: unknown[] = [];

  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (text.startsWith("INSERT INTO automod_events")) return { rows: [], rowCount: 1 } as { rows: T[] };
      if (text.startsWith("INSERT INTO moderation_cases")) return { rows: [{ id: "99" }] } as { rows: T[] };
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const events = new (await import("../src/events.js")).PlatformEventBus();
  events.on("moderation.case", (event) => moderationEvents.push(event));

  const automod = new AutoMod(db);
  await automod.init({
    client: {} as never,
    db,
    events,
    auditLog: { record: async (event: unknown) => { auditEvents.push(event); } } as never,
    identityId: "primary"
  });

  const message = {
    id: "323456789012345678",
    guild: { id: "234567890123456789" },
    channelId: "345678901234567890",
    channel: { isTextBased: () => true, send: async () => undefined },
    author: { id: "456789012345678901", username: "tester", bot: false },
    member: {
      bannable: true,
      moderatable: true,
      ban: async () => undefined,
      timeout: async () => { throw new Error("timeout should not run"); }
    },
    content: "banned content",
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => { deletes.push("deleted"); }
  };

  await (automod as unknown as {
    applyRule: (
      message: unknown,
      rule: {
        detector: string;
        action: "delete" | "timeout" | "warn" | "log" | "ban";
        timeoutMinutes: number;
        logChannelId: string | null;
        messageTemplate: string;
      }
    ) => Promise<boolean>;
  }).applyRule(message, {
    detector: "scam",
    action: "ban",
    timeoutMinutes: 30,
    logChannelId: null,
    messageTemplate: ""
  });

  await automod.shutdown();

  assert.deepEqual(deletes, ["deleted"]);
  assert.equal(calls.filter((item) => item.text.startsWith("INSERT INTO moderation_cases")).length, 1);
  assert.deepEqual(moderationEvents[0], {
    guildId: "234567890123456789",
    userId: "456789012345678901",
    action: "ban",
    caseId: 99
  });
  assert.equal((auditEvents[0] as { metadata?: { banned?: boolean } })?.metadata?.banned, true);
});
