import test from "node:test";
import assert from "node:assert/strict";
import {
  BotIdentityRepository,
  clampFailoverBatchLimit,
  isFleetHeartbeatFresh,
  resolveIdentityEnv
} from "../src/bot-identity.js";

test("primary may use legacy Discord credentials", () => {
  const old = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_TOKEN_PRIMARY: process.env.DISCORD_TOKEN_PRIMARY,
    DISCORD_CLIENT_ID_PRIMARY: process.env.DISCORD_CLIENT_ID_PRIMARY
  };
  try {
    process.env.DISCORD_TOKEN = "primary-token";
    process.env.DISCORD_CLIENT_ID = "primary-client";
    delete process.env.DISCORD_TOKEN_PRIMARY;
    delete process.env.DISCORD_CLIENT_ID_PRIMARY;

    assert.deepEqual(resolveIdentityEnv("primary"), {
      token: "primary-token",
      clientId: "primary-client"
    });
  } finally {
    restoreEnv(old);
  }
});

test("secondary identities cannot fall back to primary credentials", () => {
  const old = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_TOKEN_MUSIC2: process.env.DISCORD_TOKEN_MUSIC2,
    DISCORD_CLIENT_ID_MUSIC2: process.env.DISCORD_CLIENT_ID_MUSIC2
  };
  try {
    process.env.DISCORD_TOKEN = "primary-token";
    process.env.DISCORD_CLIENT_ID = "primary-client";
    delete process.env.DISCORD_TOKEN_MUSIC2;
    delete process.env.DISCORD_CLIENT_ID_MUSIC2;

    assert.throws(() => resolveIdentityEnv("music2"), /Missing Discord credentials/);

    process.env.DISCORD_TOKEN_MUSIC2 = "music-token";
    process.env.DISCORD_CLIENT_ID_MUSIC2 = "music-client";
    assert.deepEqual(resolveIdentityEnv("music2"), {
      token: "music-token",
      clientId: "music-client"
    });
  } finally {
    restoreEnv(old);
  }
});

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
 
test("failover claim batch limit is bounded", () => {
  assert.equal(clampFailoverBatchLimit(Number.NaN), 20);
  assert.equal(clampFailoverBatchLimit(0), 1);
  assert.equal(clampFailoverBatchLimit(20), 20);
  assert.equal(clampFailoverBatchLimit(1000), 100);
});


test("claimStaleGuilds ignores primary identities and disabled failover", async () => {
  const calls: string[] = [];
  const db = {
    query: async () => {
      calls.push("query");
      return { rows: [{ failover_enabled: false, enabled: true }] };
    },
    transaction: async () => {
      calls.push("transaction");
      return ["unexpected"];
    }
  } as never;

  const secondary = new BotIdentityRepository(db, "secondary");
  assert.deepEqual(await secondary.claimStaleGuilds(["111111111111111111"], 20), []);
  assert.deepEqual(calls, ["query"]);

  calls.length = 0;
  const primary = new BotIdentityRepository(db, "primary");
  assert.deepEqual(await primary.claimStaleGuilds(["111111111111111111"], 20), []);
  assert.deepEqual(calls, []);
});

test("claimStaleGuilds atomically returns guilds claimed by an enabled failover identity", async () => {
  let transactionCalls = 0;
  const db = {
    query: async () => ({
      rows: [{ failover_enabled: true, enabled: true }]
    }),
    transaction: async (fn: (client: never) => Promise<unknown>) => {
      transactionCalls += 1;
      const client = {
        query: async () => ({
          rows: [
            { guild_id: "111111111111111111", previous_identity_id: "primary-old" },
            { guild_id: "222222222222222222", previous_identity_id: "primary-old" }
          ]
        })
      };
      return fn(client as never);
    }
  } as never;

  const secondary = new BotIdentityRepository(db, "secondary");
  assert.deepEqual(
    await secondary.claimStaleGuilds(
      ["111111111111111111", "222222222222222222"],
      20
    ),
    [
      { guildId: "111111111111111111", previousIdentityId: "primary-old" },
      { guildId: "222222222222222222", previousIdentityId: "primary-old" }
    ]
  );
  assert.equal(transactionCalls, 1);
});


test("listFleet marks a requested restart as degraded even with a fresh heartbeat", async () => {
  const now = Date.parse("2026-10-04T10:00:00.000Z");
  const db = {
    query: async () => ({
      rows: [{
        id: "secondary",
        client_id: "client-2",
        enabled: true,
        failover_enabled: true,
        presence_name: "secondary",
        status: "ready",
        last_seen_at: new Date(now - 10_000).toISOString(),
        guild_count: "3",
        credential_configured: true,
        restart_required: true
      }]
    })
  } as never;

  const repo = new BotIdentityRepository(db, "primary");
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fleet = await repo.listFleet();
    assert.equal(fleet[0]?.restartRequired, true);
    assert.equal(fleet[0]?.status, "degraded");
    assert.equal(fleet[0]?.connected, false);
  } finally {
    Date.now = originalNow;
  }
});

test("heartbeat preserves a restart request until a new process explicitly clears it", async () => {
  const updates: readonly unknown[][] = [];
  const queries: string[] = [];
  const db = {
    query: async (text: string, values: readonly unknown[] = []) => {
      queries.push(text);
      updates.push(values);
      return { rows: [], rowCount: 1 };
    }
  } as never;

  const repo = new BotIdentityRepository(db, "secondary");
  await repo.heartbeat("ready", 4);
  await repo.heartbeat("starting", 0, true);

  assert.match(queries[0] ?? "", /restart_required/);
  assert.equal(updates[0]?.[3], false);
  assert.equal(updates[1]?.[3], true);
});

test("requestRestart marks an existing fleet heartbeat for controlled restart", async () => {
  let updateValues: readonly unknown[] = [];
  const db = {
    query: async (text: string, values: readonly unknown[] = []) => {
      if (text.startsWith("UPDATE bot_heartbeats")) updateValues = values;
      return { rows: [], rowCount: 1 };
    }
  } as never;

  const repo = new BotIdentityRepository(db, "primary");
  assert.equal(await repo.requestRestart("secondary"), true);
  assert.deepEqual(updateValues, ["secondary"]);
});

test("listFleet marks stale starting and ready heartbeats as degraded", async () => {
  const now = Date.parse("2026-10-04T10:00:00.000Z");
  const db = {
    query: async () => ({
      rows: [
        {
          id: "primary",
          client_id: "client-1",
          enabled: true,
          failover_enabled: false,
          presence_name: "primary",
          status: "starting",
          last_seen_at: new Date(now - 120_000).toISOString(),
          guild_count: "2",
          credential_configured: true
        },
        {
          id: "secondary",
          client_id: "client-2",
          enabled: true,
          failover_enabled: true,
          presence_name: "secondary",
          status: "ready",
          last_seen_at: new Date(now - 10_000).toISOString(),
          guild_count: "3",
          credential_configured: true
        }
      ]
    })
  } as never;

  const repo = new BotIdentityRepository(db, "primary");
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const fleet = await repo.listFleet();
    assert.equal(fleet.find((item) => item.id === "primary")?.status, "degraded");
    assert.equal(fleet.find((item) => item.id === "primary")?.connected, false);
    assert.equal(fleet.find((item) => item.id === "secondary")?.status, "ready");
    assert.equal(fleet.find((item) => item.id === "secondary")?.connected, true);
  } finally {
    Date.now = originalNow;
  }
});

test("verifyGuildOwnership uses a short-lived durable ownership cache", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    query: async <T>(text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      return { rows: [{ owns: true }] } as { rows: T[] };
    }
  } as never;

  const repo = new BotIdentityRepository(db, "secondary");
  assert.equal(await repo.verifyGuildOwnership("guild-1"), true);
  assert.equal(await repo.verifyGuildOwnership("guild-1"), true);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]?.values, ["guild-1", "secondary"]);
});

test("fleet heartbeat freshness uses the shared stale threshold", () => {
  const now = Date.parse("2026-10-04T10:00:00.000Z");
  assert.equal(isFleetHeartbeatFresh("2026-10-04T09:59:59.000Z", now), true);
  assert.equal(isFleetHeartbeatFresh("2026-10-04T09:58:29.000Z", now), false);
  assert.equal(isFleetHeartbeatFresh(null, now), false);
  assert.equal(isFleetHeartbeatFresh("not-a-date", now), false);
});


test("primary takeover durably reassigns stale guilds", async () => {
  let transactionCalls = 0;
  const queries: string[] = [];
  const db = {
    transaction: async (fn: (client: never) => Promise<unknown>) => {
      transactionCalls += 1;
      const client = {
        query: async (sql: string) => {
          queries.push(sql);
          return { rows: [{ guild_id: "111111111111111111", previous_identity_id: "secondary" }] };
        }
      };
      return fn(client as never);
    }
  } as never;

  const primary = new BotIdentityRepository(db, "primary");
  assert.deepEqual(await primary.claimStaleGuildsAsPrimary(["111111111111111111"], 10), [
    { guildId: "111111111111111111", previousIdentityId: "secondary" }
  ]);
  assert.equal(transactionCalls, 1);
  assert.match(queries[0] ?? "", /SET bot_identity_id='primary'/);
});

test("secondary cannot perform primary takeover", async () => {
  const db = { transaction: async () => { throw new Error("transaction_should_not_run"); } } as never;
  const secondary = new BotIdentityRepository(db, "secondary");
  assert.deepEqual(await secondary.claimStaleGuildsAsPrimary(["111111111111111111"], 10), []);
});


test("primary failover claims stale Music voice assignments without duplicating its guild assignment", async () => {
  let transactionCalls = 0;
  const queries: string[] = [];
  const db = {
    transaction: async (fn: (client: never) => Promise<unknown>) => {
      transactionCalls += 1;
      const client = {
        query: async (sql: string) => {
          queries.push(sql);
          return { rows: [{ guild_id: "222222222222222222", voice_channel_id: "333333333333333333", previous_identity_id: "secondary" }] };
        }
      };
      return fn(client as never);
    }
  } as never;

  const primary = new BotIdentityRepository(db, "primary");
  assert.deepEqual(
    await primary.claimStaleMusicAssignments(["222222222222222222"], 10),
    [{ guildId: "222222222222222222", voiceChannelId: "333333333333333333", previousIdentityId: "secondary" }]
  );
  assert.equal(transactionCalls, 1);
  assert.match(queries[0] ?? "", /UPDATE guild_music_bot_assignments/);
  assert.match(queries[0] ?? "", /NOT EXISTS/);
});

test("secondary Music failover requires failover_enabled", async () => {
  let transactionCalls = 0;
  const db = {
    query: async <T>() => ({ rows: [{ enabled: true, failover_enabled: false }] }) as { rows: T[] },
    transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction_should_not_run");
    }
  } as never;

  const secondary = new BotIdentityRepository(db, "secondary");
  assert.deepEqual(
    await secondary.claimStaleMusicAssignments(["222222222222222222"], 10),
    []
  );
  assert.equal(transactionCalls, 0);
});


test("Fleet failover result preserves previous Music identity for audit", async () => {
  const db = {
    query: async () => ({ rows: [{ failover_enabled: true, enabled: true }] }),
    transaction: async (fn: (client: never) => Promise<unknown>) => fn({
      query: async () => ({
        rows: [{
          guild_id: "111111111111111111",
          voice_channel_id: "333333333333333333",
          previous_identity_id: "secondary"
        }]
      })
    } as never)
  } as never;

  const primary = new BotIdentityRepository(db, "primary");
  assert.deepEqual(
    await primary.claimStaleMusicAssignments(["111111111111111111"], 10),
    [{
      guildId: "111111111111111111",
      voiceChannelId: "333333333333333333",
      previousIdentityId: "secondary"
    }]
  );
});
