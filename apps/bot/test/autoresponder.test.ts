import test from "node:test";
import assert from "node:assert/strict";
import { matchesAutoResponder, renderAutoResponder } from "../src/modules/autoresponder.js";

test("AutoResponder matching supports exact, contains, starts-with and regex", () => {
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "exact" }, "Hello"), true);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "exact" }, "hello world"), false);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "contains" }, "well, hello!"), true);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "starts-with" }, "Hello there"), true);
  assert.equal(matchesAutoResponder({ trigger: "^hello\\s+\\d+$", matchType: "regex" }, "hello 42"), true);
  assert.equal(matchesAutoResponder({ trigger: "[", matchType: "regex" }, "hello"), false);
});

test("AutoResponder renders bounded template variables", () => {
  assert.equal(
    renderAutoResponder("Hi {user} {mention} on {server} / {channel}", {
      user: "Jostik",
      mention: "<@1>",
      server: "DSP",
      channel: "general"
    }),
    "Hi Jostik <@1> on DSP / general"
  );
  assert.equal(renderAutoResponder("x".repeat(2200), {
    user: "u", mention: "<@1>", server: "s", channel: "c"
  }).length, 2000);
});


test("AutoResponder caches rules briefly to avoid a database read per message", async () => {
  let listQueries = 0;
  const db = {
    async query<T>(text: string) {
      if (text.includes("FROM autoresponder_rules WHERE guild_id=$1 ORDER BY priority")) {
        listQueries += 1;
        return {
          rows: [{
            id: "1",
            guild_id: "123",
            trigger: "hello",
            match_type: "contains",
            response: "Hi",
            enabled: true,
            delete_trigger: false,
            cooldown_seconds: 0,
            priority: 0,
            allowed_role_ids: [],
            ignored_role_ids: [],
            allowed_channel_ids: [],
            ignored_channel_ids: [],
            created_at: new Date(0),
            updated_at: new Date(0)
          }]
        } as unknown as { rows: T[] };
      }
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const { AutoResponder } = await import("../src/modules/autoresponder.js");
  const responders = new AutoResponder(db);
  const first = await responders.list("123");
  const second = await responders.list("123");

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(listQueries, 1);

  await responders.shutdown();
});
