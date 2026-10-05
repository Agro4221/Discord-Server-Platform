import test from "node:test";
import assert from "node:assert/strict";
import { verifyDiscordBotCredentials } from "../src/discord-bot-credentials.js";

test("Discord bot credential verifier accepts matching bot identity", async () => {
  const result = await verifyDiscordBotCredentials("123456789012345678", "bot-token", async (_url, init) => {
    assert.equal(init?.headers && "Authorization" in init.headers ? String((init.headers as Record<string, unknown>).Authorization) : "", "Bot bot-token");
    return new Response(JSON.stringify({ id: "123456789012345678", username: "DSP", bot: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  assert.deepEqual(result, {
    id: "123456789012345678",
    username: "DSP",
    bot: true
  });
});

test("Discord bot credential verifier rejects client/token mismatches", async () => {
  await assert.rejects(
    verifyDiscordBotCredentials("123456789012345678", "bot-token", async () =>
      new Response(JSON.stringify({ id: "987654321098765432", username: "Other", bot: true }), { status: 200 })
    ),
    /discord_bot_client_id_mismatch/
  );
});
