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
          rows: [{ guild_id: "111111111111111111" }, { guild_id: "222222222222222222" }]
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
    ["111111111111111111", "222222222222222222"]
  );
  assert.equal(transactionCalls, 1);
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
          return { rows: [{ guild_id: "111111111111111111" }] };
        }
      };
      return fn(client as never);
    }
  } as never;

  const primary = new BotIdentityRepository(db, "primary");
  assert.deepEqual(await primary.claimStaleGuildsAsPrimary(["111111111111111111"], 10), ["111111111111111111"]);
  assert.equal(transactionCalls, 1);
  assert.match(queries[0] ?? "", /SET bot_identity_id='primary'/);
});

test("secondary cannot perform primary takeover", async () => {
  const db = { transaction: async () => { throw new Error("transaction_should_not_run"); } } as never;
  const secondary = new BotIdentityRepository(db, "secondary");
  assert.deepEqual(await secondary.claimStaleGuildsAsPrimary(["111111111111111111"], 10), []);
});
