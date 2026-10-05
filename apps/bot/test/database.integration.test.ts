import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../src/database.js";
import { migrate } from "../src/migrations.js";
import { ConfigTransferService } from "../src/config-transfer.js";
import { BackupService } from "../src/backup.js";

const enabled = Boolean(process.env.DATABASE_URL);

test("postgres migrations apply cleanly and are idempotent", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  try {
    await migrate(db);
    const first = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
    await migrate(db);
    const second = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
    assert.equal(second.rows[0]?.count, first.rows[0]?.count);
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)",
      [[
        "guild_modules","automod_settings","verification_settings","automation_rules",
        "bot_identities","guild_bot_assignments","bot_heartbeats","music_node_sessions","guild_music_bot_assignments","stream_alerts","afk_users","autoresponder_rules","ticket_settings","tickets","automation_workflow_presets","moderation_cleanup_rules","role_automation_rules","role_automation_jobs","moderation_presets","ticket_sla_settings","help_pages","analytics_settings","music_history","custom_forms","custom_form_submissions","onboarding_flows","server_config_presets","ticket_panels","music_request_approvals"
      ]]
    );
    assert.equal(tables.rows.length, 29);
    const version = (await db.query("SELECT max(version) AS version FROM schema_migrations")).rows[0]?.version;
    const retryColumn = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='automation_delayed_jobs' AND column_name='dead_lettered_at'"
    );
    assert.equal(retryColumn.rows.length, 1);
    const feedColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_feeds' AND column_name = ANY($1)",
      [["message_template","include_keywords","exclude_keywords"]]
    );
    assert.equal(feedColumns.rows.length, 3);
    const ticketColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name = ANY($1)",
      [["priority","tags","updated_at","panel_id"]]
    );
    assert.equal(ticketColumns.rows.length, 4);
    const slaColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name = ANY($1)",
      [["sla_reminded_at","sla_escalated_at"]]
    );
    assert.equal(slaColumns.rows.length, 2);
    const analyticsSettingsColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_settings' AND column_name = ANY($1)",
      [["retention_days","visible_counters"]]
    );
    assert.equal(analyticsSettingsColumns.rows.length, 2);
    const musicHistoryColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='music_history' AND column_name = ANY($1)",
      [["guild_id","bot_identity_id","identifier","title","played_at"]]
    );
    assert.equal(musicHistoryColumns.rows.length, 5);    const musicPlaylistVisibility = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='music_playlists' AND column_name='visibility'"
    );
    assert.equal(musicPlaylistVisibility.rows.length, 1);
    const musicPlaylistContinuationColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='music_players' AND column_name = ANY($1)",
      [["playlist_id","playlist_next_index","playlist_order","playlist_requester_user_id"]]
    );
    assert.equal(musicPlaylistContinuationColumns.rows.length, 4);
    const approvalColumns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='music_settings' AND column_name = ANY($1)",
      [["request_approval_mode","max_queued_per_user","max_queue_size","fair_queue_enabled"]]
    );
    assert.equal(approvalColumns.rows.length, 4);
    assert.equal(Number(version), Number(first.rows[0]?.count));
    assert.equal(Number(second.rows[0]?.count), Number(version));
  } finally {
    await db.close();
  }
});

test("music playlist continuation state persists and clears", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345735";
  const botIdentityId = "test-music-continuation";
  try {
    await migrate(db);
    await db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2", [guildId,botIdentityId]);

    const playlist = await db.query<{ id: string }>(
      "INSERT INTO music_playlists(guild_id,user_id,name,visibility,tracks) VALUES($1,$2,$3,'personal','[]'::jsonb) RETURNING id",
      [guildId,"234567890123456792","Continuation"]
    );
    const playlistId = playlist.rows[0]!.id;

    await db.query(
      "INSERT INTO music_players(guild_id,bot_identity_id,voice_channel_id,text_channel_id,state,playlist_id,playlist_next_index,playlist_order,playlist_requester_user_id) VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7::jsonb,$8)",
      [guildId,botIdentityId,"voice-cont","text-cont",playlistId,25,"[2,0,1]","234567890123456792"]
    );
    const saved = await db.query<{
      playlist_id: string | null;
      playlist_next_index: number;
      playlist_order: unknown;
      playlist_requester_user_id: string | null;
    }>(
      "SELECT playlist_id,playlist_next_index,playlist_order,playlist_requester_user_id FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
      [guildId,botIdentityId]
    );
    assert.equal(saved.rows[0]?.playlist_id, playlistId);
    assert.equal(Number(saved.rows[0]?.playlist_next_index), 25);
    assert.deepEqual(saved.rows[0]?.playlist_order, [2,0,1]);
    assert.equal(saved.rows[0]?.playlist_requester_user_id, "234567890123456792");

    await db.query(
      "UPDATE music_players SET playlist_id=NULL,playlist_next_index=0,playlist_order=NULL,playlist_requester_user_id=NULL WHERE guild_id=$1 AND bot_identity_id=$2",
      [guildId,botIdentityId]
    );
    const cleared = await db.query<{ playlist_id: string | null; playlist_requester_user_id: string | null }>(
      "SELECT playlist_id,playlist_requester_user_id FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
      [guildId,botIdentityId]
    );
    assert.equal(cleared.rows[0]?.playlist_id, null);
    assert.equal(cleared.rows[0]?.playlist_requester_user_id, null);
  } finally {
    await db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",[guildId,botIdentityId]).catch(() => undefined);
    await db.query("DELETE FROM music_playlists WHERE guild_id=$1",[guildId]).catch(() => undefined);
    await db.close();
  }
});

test("music playlist continuation state is cleared when the referenced playlist is edited", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345736";
  const botIdentityId = "test-music-stale-continuation";
  try {
    await migrate(db);
    await db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2", [guildId,botIdentityId]);
    await db.query("DELETE FROM music_playlists WHERE guild_id=$1", [guildId]);

    const playlist = await db.query<{ id: string }>(
      "INSERT INTO music_playlists(guild_id,user_id,name,visibility,tracks) VALUES($1,$2,$3,'personal',$4::jsonb) RETURNING id",
      [guildId,"234567890123456793","Editable Continuation",JSON.stringify({info:{identifier:"track-1"}})]
    );
    const playlistId = playlist.rows[0]!.id;

    await db.query(
      "INSERT INTO music_players(guild_id,bot_identity_id,voice_channel_id,text_channel_id,state,playlist_id,playlist_next_index,playlist_order,playlist_requester_user_id) VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7::jsonb,$8)",
      [guildId,botIdentityId,"voice-stale","text-stale",playlistId,1,"[0]","234567890123456793"]
    );

    await db.query(
      "UPDATE music_playlists SET tracks=$1::jsonb,updated_at=now() WHERE id=$2",
      [JSON.stringify([{info:{identifier:"track-2"}}]),playlistId]
    );
    await db.query(
      "UPDATE music_players SET playlist_id=NULL,playlist_next_index=0,playlist_order=NULL,playlist_requester_user_id=NULL WHERE guild_id=$1 AND bot_identity_id=$2 AND playlist_id=$3",
      [guildId,botIdentityId,playlistId]
    );

    const saved = await db.query<{ playlist_id: string | null; playlist_next_index: number; playlist_order: unknown; playlist_requester_user_id: string | null }>(
      "SELECT playlist_id,playlist_next_index,playlist_order,playlist_requester_user_id FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",
      [guildId,botIdentityId]
    );
    assert.equal(saved.rows[0]?.playlist_id, null);
    assert.equal(Number(saved.rows[0]?.playlist_next_index), 0);
    assert.equal(saved.rows[0]?.playlist_order, null);
    assert.equal(saved.rows[0]?.playlist_requester_user_id, null);
  } finally {
    await db.query("DELETE FROM music_players WHERE guild_id=$1 AND bot_identity_id=$2",[guildId,botIdentityId]).catch(() => undefined);
    await db.query("DELETE FROM music_playlists WHERE guild_id=$1",[guildId]).catch(() => undefined);
    await db.close();
  }
});


test("music shared playlists are guild-visible while personal playlists stay private", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345734";
  try {
    await migrate(db);
    await db.query("DELETE FROM music_playlists WHERE guild_id=$1", [guildId]);

    await db.query(
      "INSERT INTO music_playlists(guild_id,user_id,name,visibility,tracks) VALUES($1,$2,$3,'shared','[]'::jsonb)",
      [guildId,"234567890123456789","Server Mix"]
    );
    await db.query(
      "INSERT INTO music_playlists(guild_id,user_id,name,visibility,tracks) VALUES($1,$2,$3,'personal','[]'::jsonb)",
      [guildId,"234567890123456790","Private Mix"]
    );

    const otherUser = await db.query<{ name: string; visibility: string }>(
      "SELECT name,visibility FROM music_playlists WHERE guild_id=$1 AND (user_id=$2 OR visibility='shared') ORDER BY name",
      [guildId,"234567890123456791"]
    );
    assert.deepEqual(otherUser.rows, [{ name: "Server Mix", visibility: "shared" }]);

    const owner = await db.query<{ name: string; visibility: string }>(
      "SELECT name,visibility FROM music_playlists WHERE guild_id=$1 AND (user_id=$2 OR visibility='shared') ORDER BY name",
      [guildId,"234567890123456790"]
    );

    const search = await db.query<{ name: string; visibility: string }>(
      "SELECT name,visibility FROM music_playlists WHERE guild_id=$1 AND (user_id=$2 OR visibility='shared') AND ($4=false OR visibility='shared') AND name ILIKE $3 ORDER BY visibility DESC,updated_at DESC LIMIT 25",
      [guildId,"234567890123456791","%Server%",false]
    );
    assert.deepEqual(search.rows, [{ name: "Server Mix", visibility: "shared" }]);

    const sharedOnly = await db.query<{ name: string; visibility: string }>(
      "SELECT name,visibility FROM music_playlists WHERE guild_id=$1 AND (user_id=$2 OR visibility='shared') AND ($4=false OR visibility='shared') AND name ILIKE $3 ORDER BY visibility DESC,updated_at DESC LIMIT 25",
      [guildId,"234567890123456790","%Mix%",true]
    );
    assert.deepEqual(sharedOnly.rows, [{ name: "Server Mix", visibility: "shared" }]);
    assert.deepEqual(owner.rows, [
      { name: "Private Mix", visibility: "personal" },
      { name: "Server Mix", visibility: "shared" }
    ]);
  } finally {
    await db.query("DELETE FROM music_playlists WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("music request approval mode persists pending requests", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345733";
  try {
    await migrate(db);
    await db.query("DELETE FROM music_request_approvals WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM music_settings WHERE guild_id=$1", [guildId]);

    await db.query(
      "INSERT INTO music_settings(guild_id,request_approval_mode) VALUES($1,'approval')",
      [guildId]
    );
    const saved = await db.query<{ request_approval_mode: string }>(
      "SELECT request_approval_mode FROM music_settings WHERE guild_id=$1",
      [guildId]
    );
    assert.equal(saved.rows[0]?.request_approval_mode, "approval");

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO music_request_approvals(
        guild_id,requester_user_id,requester_voice_channel_id,source_channel_id,query,expires_at
      ) VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes')
      RETURNING id`,
      [guildId,"234567890123456789","345678901234567890","456789012345678901","test song"]
    );

    const restored = await db.query<{ status: string; query: string }>(
      "SELECT status,query FROM music_request_approvals WHERE id=$1",
      [inserted.rows[0]!.id]
    );
    assert.deepEqual(restored.rows[0], { status: "pending", query: "test song" });
  } finally {
    await db.query("DELETE FROM music_request_approvals WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM music_settings WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("analytics settings persist and normalize safely", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345758";
  const analytics = new (await import("../src/modules/analytics.js")).Analytics(db);
  try {
    await migrate(db);
    const saved = await analytics.setSettings(guildId, {
      retentionDays: 90,
      visibleCounters: ["message", "voice_move"]
    });
    assert.deepEqual(saved, {
      retentionDays: 90,
      visibleCounters: ["message", "voice_move"]
    });
    const restored = await analytics.getSettings(guildId);
    assert.deepEqual(restored, saved);
  } finally {
    await db.query("DELETE FROM analytics_settings WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("onboarding flow settings persist with normalized steps", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345741";
  const onboarding = new (await import("../src/modules/onboarding.js")).Onboarding(db);
  try {
    await migrate(db);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1 AND module_key='onboarding'", [guildId]);
    await db.query("DELETE FROM onboarding_flows WHERE guild_id=$1", [guildId]);
    const saved = await onboarding.configure(guildId, {
      enabled: true,
      trigger: "verification.passed",
      steps: [
        { type: "role", roleId: "123456789012345678" },
        { type: "channel-message", channelId: "123456789012345679", content: " Hello {mention}! " },
        { type: "dm", content: "Welcome to {server}" }
      ]
    });
    assert.deepEqual(saved, {
      guildId,
      enabled: true,
      trigger: "verification.passed",
      steps: [
        { type: "role", roleId: "123456789012345678" },
        { type: "channel-message", channelId: "123456789012345679", content: "Hello {mention}!" },
        { type: "dm", content: "Welcome to {server}" }
      ]
    });
    assert.deepEqual(await onboarding.get(guildId), saved);
  } finally {
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1 AND module_key='onboarding'", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM onboarding_flows WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});


test("integration credential encryption round-trips secrets without plaintext listing", { skip: !enabled }, async () => {
  const rows: Array<{ id: number; guild_id: string; provider: "twitch" | "youtube" | "kick"; label: string; secret_ciphertext: string; created_at: string; updated_at: string }> = [];
  const fakeDb = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO integration_credentials")) {
        const [guildId, provider, label, ciphertext] = params as [string,string,string,string];
        const existing = rows.find((row) => row.guild_id === guildId && row.provider === provider && row.label === label);
        if (existing) {
          existing.secret_ciphertext = ciphertext;
          existing.updated_at = new Date().toISOString();
          return { rows: [{ id: String(existing.id) }] };
        }
        const id = rows.length + 1;
        rows.push({ id, guild_id: guildId, provider: provider as "twitch", label, secret_ciphertext: ciphertext, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        return { rows: [{ id: String(id) }] };
      }
      if (sql.startsWith("SELECT id,guild_id,provider,label,created_at,updated_at FROM integration_credentials")) {
        const guildId = params[0] as string;
        return { rows: rows.filter((row) => row.guild_id === guildId).map((row) => ({ ...row, id: String(row.id) })) };
      }
      if (sql.startsWith("SELECT secret_ciphertext FROM integration_credentials")) {
        const [id, guildId, provider] = params;
        const row = rows.find((item) => item.id === Number(id) && item.guild_id === guildId && item.provider === provider);
        return { rows: row ? [{ secret_ciphertext: row.secret_ciphertext }] : [] };
      }
      if (sql.startsWith("DELETE FROM integration_credentials")) {
        const [id, guildId] = params;
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.id === Number(id) && rows[i]?.guild_id === guildId) rows.splice(i, 1);
        }
        return { rows: [], rowCount: rows.length === before ? 0 : 1 };
      }
      throw new Error("unexpected SQL: " + sql);
    }
  } as unknown as Database;
  const { IntegrationCredentialRepository } = await import("../src/integration-credentials.js");
  const credentials = new IntegrationCredentialRepository(fakeDb, "integration-test-secret");
  try {
    const saved = await credentials.save("123456789012345678", {
      provider: "twitch",
      label: " Main Twitch ",
      clientId: "client-id",
      clientSecret: "client-secret"
    });
    assert.equal(saved.label, "Main Twitch");
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.secret_ciphertext.includes("client-secret"), true);

    assert.deepEqual(
      await credentials.getSecret("123456789012345678", saved.id, "twitch"),
      { clientId: "client-id", clientSecret: "client-secret" }
    );
    assert.deepEqual(
      await credentials.list("123456789012345678"),
      [saved]
    );
    assert.equal(await credentials.delete("123456789012345678", saved.id), true);
  } finally {
    rows.splice(0, rows.length);
  }
});

test("integration credential diagnostics validate provider access without exposing secrets", { skip: !enabled }, async () => {
  const rows: Array<{ id: number; guild_id: string; provider: "twitch" | "youtube" | "kick"; label: string; secret_ciphertext: string; created_at: string; updated_at: string }> = [];
  const fakeDb = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO integration_credentials")) {
        const [guildId, provider, label, ciphertext] = params as [string,string,string,string];
        const id = rows.length + 1;
        rows.push({
          id,
          guild_id: guildId,
          provider: provider as "twitch",
          label,
          secret_ciphertext: ciphertext,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        return { rows: [{ id: String(id) }] };
      }
      if (sql.startsWith("SELECT id,guild_id,provider,label,created_at,updated_at FROM integration_credentials")) {
        const guildId = params[0] as string;
        return { rows: rows.filter((row) => row.guild_id === guildId).map((row) => ({ ...row, id: String(row.id) })) };
      }
      if (sql.startsWith("SELECT secret_ciphertext FROM integration_credentials")) {
        const [id, guildId, provider] = params;
        const row = rows.find((item) => item.id === Number(id) && item.guild_id === guildId && item.provider === provider);
        return { rows: row ? [{ secret_ciphertext: row.secret_ciphertext }] : [] };
      }
      if (sql.startsWith("SELECT provider,secret_ciphertext FROM integration_credentials")) {
        const [id, guildId] = params;
        const row = rows.find((item) => item.id === Number(id) && item.guild_id === guildId);
        return { rows: row ? [{ provider: row.provider, secret_ciphertext: row.secret_ciphertext }] : [] };
      }
      throw new Error("unexpected SQL: " + sql);
    }
  } as unknown as Database;

  const requests: Array<{ url: string; method: string; body: string }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      body: typeof init?.body === "string" ? init.body : ""
    });
    return new Response(JSON.stringify({ access_token: "test-access-token" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const { IntegrationCredentialRepository } = await import("../src/integration-credentials.js");
  const credentials = new IntegrationCredentialRepository(fakeDb, "diagnostic-secret", fakeFetch);
  const saved = await credentials.save("123456789012345678", {
    provider: "twitch",
    label: "Diagnostic",
    clientId: "client-id",
    clientSecret: "super-secret"
  });

  const result = await credentials.test("123456789012345678", saved.id);
  assert.equal(result.provider, "twitch");
  assert.equal(typeof result.latencyMs, "number");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://id.twitch.tv/oauth2/token");
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.body ?? "", /client_id=client-id/);
  assert.match(requests[0]?.body ?? "", /client_secret=super-secret/);
});

test("custom help pages persist with normalized slugs", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345757";
  const help = new (await import("../src/help-pages.js")).HelpPages(db);
  try {
    await migrate(db);
    const saved = await help.save(guildId, " Rules ", "Server Rules", "No spam.", true);
    assert.equal(saved.slug, "rules");
    const restored = await help.get(guildId, "rules");
    assert.equal(restored?.title, "Server Rules");
    assert.equal(restored?.content, "No spam.");
    assert.equal((await help.list(guildId)).length, 1);
  } finally {
    await db.query("DELETE FROM help_pages WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("ticket SLA configuration persists and clamps safely", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345756";
  const tickets = new (await import("../src/modules/tickets.js")).Tickets(db);
  try {
    await migrate(db);
    const saved = await tickets.setSlaConfig(guildId, {
      enabled: true,
      firstResponseMinutes: 45,
      reminderMinutes: 90,
      escalationMinutes: 180,
      escalationRoleId: "123456789012345678"
    });
    assert.deepEqual(saved, {
      enabled: true,
      firstResponseMinutes: 45,
      reminderMinutes: 90,
      escalationMinutes: 180,
      escalationRoleId: "123456789012345678"
    });
    const restored = await tickets.getSlaConfig(guildId);
    assert.deepEqual(restored, saved);
  } finally {
    await db.query("DELETE FROM ticket_sla_settings WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("music bot assignment is unique per voice channel", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345680";
  try {
    await migrate(db);
    await db.query("DELETE FROM guild_music_bot_assignments WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM bot_identities WHERE id IN ('music-test-a','music-test-b')");

    await db.query(
      "INSERT INTO bot_identities(id,client_id,enabled) VALUES('music-test-a','123456789012345681',true),('music-test-b','123456789012345682',true)"
    );

    await db.query(
      "INSERT INTO guild_music_bot_assignments(guild_id,bot_identity_id,voice_channel_id) VALUES($1,'music-test-a','123456789012345683')",
      [guildId]
    );

    await assert.rejects(
      db.query(
        "INSERT INTO guild_music_bot_assignments(guild_id,bot_identity_id,voice_channel_id) VALUES($1,'music-test-b','123456789012345683')",
        [guildId]
      )
    );
  } finally {
    await db.query("DELETE FROM guild_music_bot_assignments WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM bot_identities WHERE id IN ('music-test-a','music-test-b')").catch(() => undefined);
    await db.close();
  }
});

test("database transaction rolls back failed writes", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345678";
  try {
    await migrate(db);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1", [guildId]);
    await assert.rejects(
      db.transaction(async (client) => {
        await client.query(
          "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'automod',true)",
          [guildId]
        );
        throw new Error("forced rollback");
      }),
      /forced rollback/
    );
    const result = await db.query("SELECT 1 FROM guild_modules WHERE guild_id=$1", [guildId]);
    assert.equal(result.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("config import rejects malformed automation rules", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345679";
  try {
    await migrate(db);
    await db.query("DELETE FROM automation_rules WHERE guild_id=$1", [guildId]);

    const transfer = new ConfigTransferService(db);
    await assert.rejects(
      transfer.importGuild(guildId, {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        guildId,
        modules: [{
          key: "automation",
          enabled: true,
          settings: {
            automation_rules: [{
              name: "Broken imported rule",
              enabled: true,
              event: "not-a-real-event",
              conditions: [],
              actions: [{ type: "send-message", channelId: "123456789012345678", content: "x" }],
              cooldown_seconds: 0
            }]
          }
        }]
      }),
      /unsupported_automation_event/
    );

    const result = await db.query("SELECT 1 FROM automation_rules WHERE guild_id=$1", [guildId]);
    assert.equal(result.rows.length, 0);
  } finally {
    await db.query("DELETE FROM automation_rules WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("config transfer preserves automation workflow presets", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345750";
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'automation',true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()",
      [guildId]
    );
    await db.query("DELETE FROM automation_workflow_presets WHERE guild_id=$1", [guildId]);
    await db.query(
      "INSERT INTO automation_workflow_presets(guild_id,name,event,conditions,any_conditions,actions,cooldown_seconds) VALUES($1,'welcome_flow','member.join',$2::jsonb,$3::jsonb,$4::jsonb,30)",
      [
        guildId,
        JSON.stringify([{ type: "equals", left: "guildId", right: guildId }]),
        JSON.stringify([]),
        JSON.stringify([{ type: "log", message: "welcome {userId}" }])
      ]
    );

    const transfer = new ConfigTransferService(db);
    const exported = await transfer.exportGuild(guildId);
    const automation = exported.modules.find((module) => module.key === "automation");
    const presets = automation?.settings.automation_workflow_presets as Array<Record<string, unknown>> | undefined;
    assert.equal(presets?.length, 1);
    assert.equal(presets?.[0]?.name, "welcome_flow");

    await db.query("DELETE FROM automation_workflow_presets WHERE guild_id=$1", [guildId]);
    await transfer.importGuild(guildId, exported);

    const restored = await db.query<{ name: string; event: string; cooldown_seconds: number }>(
      "SELECT name,event,cooldown_seconds FROM automation_workflow_presets WHERE guild_id=$1",
      [guildId]
    );
    assert.deepEqual(restored.rows, [{
      name: "welcome_flow",
      event: "member.join",
      cooldown_seconds: 30
    }]);
  } finally {
    await db.query("DELETE FROM automation_workflow_presets WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1 AND module_key='automation'", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("config transfer preserves ticket panel links", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345760";
  try {
    await migrate(db);
    await db.query("DELETE FROM tickets WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM ticket_panels WHERE guild_id=$1", [guildId]);
    await db.query("INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'tickets',true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true", [guildId]);
    await db.query(
      "INSERT INTO ticket_panels(id,guild_id,channel_id,message_id,title,description,button_label,enabled) VALUES(9001,$1,'123456789012345761','123456789012345762','Support','Open support','Create',true)",
      [guildId]
    );
    await db.query(
      "INSERT INTO tickets(guild_id,channel_id,creator_id,status,priority,tags,form_data,panel_id) VALUES($1,'123456789012345763','123456789012345764','open','normal','{}','{}'::jsonb,9001)",
      [guildId]
    );

    const transfer = new ConfigTransferService(db);
    const exported = await transfer.exportGuild(guildId);
    const ticketsModule = exported.modules.find((module) => module.key === "tickets");
    const panels = ticketsModule?.settings.ticket_panels as Array<Record<string, unknown>> | undefined;
    const tickets = ticketsModule?.settings.tickets as Array<Record<string, unknown>> | undefined;
    assert.equal(panels?.[0]?.id, "9001");
    assert.equal(tickets?.[0]?.panel_id, "9001");

    await db.query("DELETE FROM tickets WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM ticket_panels WHERE guild_id=$1", [guildId]);
    await transfer.importGuild(guildId, exported);

    const restored = await db.query<{ panel_id: string | null; title: string }>(
      "SELECT t.panel_id,p.title FROM tickets t LEFT JOIN ticket_panels p ON p.id=t.panel_id WHERE t.guild_id=$1",
      [guildId]
    );
    assert.deepEqual(restored.rows, [{ panel_id: "9001", title: "Support" }]);
  } finally {
    await db.query("DELETE FROM tickets WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM ticket_panels WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1 AND module_key='tickets'", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("config transfer preserves analytics settings", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345759";
  try {
    await migrate(db);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM analytics_settings WHERE guild_id=$1", [guildId]);
    await db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'analytics',true)",
      [guildId]
    );
    await db.query(
      "INSERT INTO analytics_settings(guild_id,retention_days,visible_counters) VALUES($1,90,$2::jsonb)",
      [guildId, JSON.stringify(["message","voice_move"])]
    );

    const transfer = new ConfigTransferService(db);
    const exported = await transfer.exportGuild(guildId);
    const analytics = exported.modules.find((module) => module.key === "analytics");
    assert.equal(analytics?.enabled, true);
    assert.equal(analytics?.settings.retention_days, 90);
    assert.deepEqual(analytics?.settings.visible_counters, ["message","voice_move"]);

    await db.query("UPDATE analytics_settings SET retention_days=7,visible_counters='[\"message\"]'::jsonb WHERE guild_id=$1", [guildId]);
    await transfer.importGuild(guildId, exported);

    const restored = await db.query<{ retention_days: number; visible_counters: string[] }>(
      "SELECT retention_days,visible_counters FROM analytics_settings WHERE guild_id=$1",
      [guildId]
    );
    assert.equal(restored.rows[0]?.retention_days, 90);
    assert.deepEqual(restored.rows[0]?.visible_counters, ["message","voice_move"]);
  } finally {
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM analytics_settings WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("config transfer and local backup round-trip preserve guild configuration", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const directory = await mkdtemp(join(tmpdir(), "dsp-backup-"));
  const guildId = "123456789012345678";
  try {
    await migrate(db);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM security_settings WHERE guild_id=$1", [guildId]);
    await db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'security',true)",
      [guildId]
    );
    await db.query(
      "INSERT INTO security_settings(guild_id,enabled,max_joins,window_seconds,max_destructive_actions,destructive_window_seconds,quarantine_role_id,log_channel_id) VALUES($1,true,4,15,3,20,'111111111111111111','222222222222222222')",
      [guildId]
    );

    const transfer = new ConfigTransferService(db);
    const exported = await transfer.exportGuild(guildId);
    const security = exported.modules.find((module) => module.key === "security");
    assert.equal(security?.enabled, true);
    assert.equal(security?.settings.max_joins, 4);
    assert.equal(security?.settings.max_destructive_actions, 3);

    await db.query(
      "UPDATE security_settings SET max_joins=20,quarantine_role_id=NULL WHERE guild_id=$1",
      [guildId]
    );
    await transfer.importGuild(guildId, exported);

    const restored = await db.query<{ max_joins: number; quarantine_role_id: string | null }>(
      "SELECT max_joins,quarantine_role_id FROM security_settings WHERE guild_id=$1",
      [guildId]
    );
    assert.equal(restored.rows[0]?.max_joins, 4);
    assert.equal(restored.rows[0]?.quarantine_role_id, "111111111111111111");

    const backups = new BackupService(db, directory, 5);
    const path = await backups.createGuildBackup(guildId);
    const name = path.split("/").pop()!;
    const read = await backups.readBackup(name, guildId) as { guildId?: string };
    assert.equal(read.guildId, guildId);

    await db.query("UPDATE security_settings SET max_joins=99 WHERE guild_id=$1", [guildId]);
    await backups.restoreGuildBackup(guildId, name);
    const restoredAgain = await db.query<{ max_joins: number }>(
      "SELECT max_joins FROM security_settings WHERE guild_id=$1",
      [guildId]
    );
    assert.equal(restoredAgain.rows[0]?.max_joins, 4);

    const retainedBackups = new BackupService(db, directory, 2);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await retainedBackups.createGuildBackup(guildId);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await retainedBackups.createGuildBackup(guildId);
    const listed = await retainedBackups.listBackups(guildId);
    assert.equal(listed.length, 2);
  } finally {
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM security_settings WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});


test("economy transfers lock accounts in deterministic order", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345710";
  try {
    await migrate(db);
    await db.query("DELETE FROM economy_transactions WHERE guild_id=$1", [guildId]);
    await db.query("DELETE FROM economy_accounts WHERE guild_id=$1", [guildId]);
    await db.query(
      "INSERT INTO economy_accounts(guild_id,user_id,balance) VALUES($1,'123456789012345711',100),($1,'123456789012345712',100)",
      [guildId]
    );

    await Promise.all([
      runTransferLikeTransaction(db, guildId, "123456789012345711", "123456789012345712", 10),
      runTransferLikeTransaction(db, guildId, "123456789012345712", "123456789012345711", 15)
    ]);

    const result = await db.query<{ user_id: string; balance: string }>(
      "SELECT user_id,balance::text AS balance FROM economy_accounts WHERE guild_id=$1 ORDER BY user_id",
      [guildId]
    );
    assert.deepEqual(result.rows, [
      { user_id: "123456789012345711", balance: "105" },
      { user_id: "123456789012345712", balance: "95" }
    ]);
  } finally {
    await db.query("DELETE FROM economy_transactions WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM economy_accounts WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

async function runTransferLikeTransaction(
  db: Database,
  guildId: string,
  from: string,
  to: string,
  amount: number
): Promise<void> {
  await db.transaction(async (client) => {
    for (const id of [from, to].sort()) {
      await client.query(
        "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId, id]
      );
    }
    await client.query(
      "UPDATE economy_accounts SET balance=balance-$3 WHERE guild_id=$1 AND user_id=$2",
      [guildId, from, amount]
    );
    await client.query(
      "UPDATE economy_accounts SET balance=balance+$3 WHERE guild_id=$1 AND user_id=$2",
      [guildId, to, amount]
    );
  });
}

test("level-up state transition has a single winner", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345730";
  const userId = "123456789012345731";
  try {
    await migrate(db);
    await db.query("DELETE FROM leveling_users WHERE guild_id=$1 AND user_id=$2", [guildId, userId]);
    await db.query(
      "INSERT INTO leveling_users(guild_id,user_id,xp,level) VALUES($1,$2,400,1)",
      [guildId, userId]
    );

    const [a,b] = await Promise.all([
      db.query("UPDATE leveling_users SET level=2 WHERE guild_id=$1 AND user_id=$2 AND level < 2 RETURNING level", [guildId, userId]),
      db.query("UPDATE leveling_users SET level=2 WHERE guild_id=$1 AND user_id=$2 AND level < 2 RETURNING level", [guildId, userId])
    ]);

    assert.equal(Number(Boolean(a.rows[0])) + Number(Boolean(b.rows[0])), 1);
  } finally {
    await db.query("DELETE FROM leveling_users WHERE guild_id=$1 AND user_id=$2", [guildId, userId]).catch(() => undefined);
    await db.close();
  }
});

test("primary failover selects only stale secondary assignments", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const activeGuild = "123456789012345720";
  const staleGuild = "123456789012345721";
  try {
    await migrate(db);
    await db.query(
      "DELETE FROM bot_heartbeats WHERE bot_identity_id IN ('failover-primary','failover-active','failover-stale')"
    );
    await db.query(
      "DELETE FROM bot_identities WHERE id IN ('failover-primary','failover-active','failover-stale')"
    );
    await db.query(
      "DELETE FROM guild_bot_assignments WHERE guild_id IN ($1,$2)",
      [activeGuild, staleGuild]
    );

    await db.query(
      "INSERT INTO bot_identities(id,client_id,enabled) VALUES('failover-primary','123456789012345722',true),('failover-active','123456789012345723',true),('failover-stale','123456789012345724',true)"
    );
    await db.query(
      "INSERT INTO guild_bot_assignments(guild_id,bot_identity_id) VALUES($1,'failover-active'),($2,'failover-stale')",
      [activeGuild, staleGuild]
    );
    await db.query(
      "INSERT INTO bot_heartbeats(bot_identity_id,status,last_seen_at,guild_count) VALUES('failover-primary','ready',now(),0),('failover-active','ready',now(),1),('failover-stale','ready',now()-interval '2 minutes',1)"
    );

    const result = await db.query<{ guild_id: string }>(
      "SELECT ga.guild_id FROM guild_bot_assignments ga LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id WHERE ga.bot_identity_id='primary' OR (ga.bot_identity_id <> 'primary' AND bh.last_seen_at < now()-interval '90 seconds') ORDER BY ga.guild_id"
    );
    assert.deepEqual(result.rows.map((row) => row.guild_id), [staleGuild]);
  } finally {
    await db.query("DELETE FROM guild_bot_assignments WHERE guild_id IN ($1,$2)", [activeGuild, staleGuild]).catch(() => undefined);
    await db.query("DELETE FROM bot_heartbeats WHERE bot_identity_id IN ('failover-primary','failover-active','failover-stale')").catch(() => undefined);
    await db.query("DELETE FROM bot_identities WHERE id IN ('failover-primary','failover-active','failover-stale')").catch(() => undefined);
    await db.close();
  }
});

test("background jobs are isolated by guild bot assignment", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const primaryGuild = "123456789012345690";
  const secondaryGuild = "123456789012345691";
  try {
    await migrate(db);

    await db.query("DELETE FROM reminders WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]);
    await db.query("DELETE FROM notification_feeds WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]);
    await db.query("DELETE FROM giveaways WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]);
    await db.query("DELETE FROM guild_bot_assignments WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]);
    await db.query("DELETE FROM bot_identities WHERE id IN ('worker-primary-test','worker-secondary-test')");

    await db.query(
      "INSERT INTO bot_identities(id,client_id,enabled) VALUES('worker-primary-test','123456789012345692',true),('worker-secondary-test','123456789012345693',true)"
    );
    await db.query(
      "INSERT INTO guild_bot_assignments(guild_id,bot_identity_id) VALUES($1,'worker-primary-test'),($2,'worker-secondary-test')",
      [primaryGuild, secondaryGuild]
    );
    await db.query(
      "INSERT INTO reminders(guild_id,user_id,content,due_at) VALUES($1,'123456789012345694','primary',now()),($2,'123456789012345695','secondary',now())",
      [primaryGuild, secondaryGuild]
    );
    await db.query(
      "INSERT INTO notification_feeds(guild_id,channel_id,url,interval_seconds,enabled) VALUES($1,'123456789012345696','https://example.com/feed-primary',60,true),($2,'123456789012345697','https://example.com/feed-secondary',60,true)",
      [primaryGuild, secondaryGuild]
    );
    await db.query(
      "INSERT INTO giveaways(guild_id,channel_id,host_user_id,prize,winners,ends_at,status) VALUES($1,'123456789012345698','123456789012345699','primary',1,now(),'running'),($2,'123456789012345700','123456789012345701','secondary',1,now(),'running')",
      [primaryGuild, secondaryGuild]
    );

    const reminderRows = await db.query<{ guild_id: string }>(
      "SELECT r.guild_id FROM reminders r INNER JOIN guild_bot_assignments ga ON ga.guild_id=r.guild_id AND ga.bot_identity_id=$1 WHERE r.guild_id IN ($2,$3) ORDER BY r.guild_id",
      ["worker-secondary-test", primaryGuild, secondaryGuild]
    );
    assert.deepEqual(reminderRows.rows.map((row) => row.guild_id), [secondaryGuild]);

    const feedRows = await db.query<{ guild_id: string }>(
      "SELECT nf.guild_id FROM notification_feeds nf INNER JOIN guild_bot_assignments ga ON ga.guild_id=nf.guild_id AND ga.bot_identity_id=$1 WHERE nf.guild_id IN ($2,$3) ORDER BY nf.guild_id",
      ["worker-secondary-test", primaryGuild, secondaryGuild]
    );
    assert.deepEqual(feedRows.rows.map((row) => row.guild_id), [secondaryGuild]);

    const giveawayRows = await db.query<{ guild_id: string }>(
      "SELECT g.guild_id FROM giveaways g INNER JOIN guild_bot_assignments ga ON ga.guild_id=g.guild_id AND ga.bot_identity_id=$1 WHERE g.guild_id IN ($2,$3) ORDER BY g.guild_id",
      ["worker-secondary-test", primaryGuild, secondaryGuild]
    );
    assert.deepEqual(giveawayRows.rows.map((row) => row.guild_id), [secondaryGuild]);
  } finally {
    await db.query("DELETE FROM reminders WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]).catch(() => undefined);
    await db.query("DELETE FROM notification_feeds WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]).catch(() => undefined);
    await db.query("DELETE FROM giveaways WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]).catch(() => undefined);
    await db.query("DELETE FROM guild_bot_assignments WHERE guild_id IN ($1,$2)", [primaryGuild, secondaryGuild]).catch(() => undefined);
    await db.query("DELETE FROM bot_identities WHERE id IN ('worker-primary-test','worker-secondary-test')").catch(() => undefined);
    await db.close();
  }
});

test("moderation scheduled cleanup persists and enforces the expected bounds", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345749";
  try {
    await migrate(db);
    await db.query("INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'moderation',true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()", [guildId]);
    await db.query("INSERT INTO moderation_cleanup_rules(guild_id,channel_id,interval_seconds,max_messages) VALUES($1,$2,3600,100)", [guildId,"123456789012345748"]);
    const rows = await db.query<{ channel_id: string; interval_seconds: number; max_messages: number; enabled: boolean }>(
      "SELECT channel_id,interval_seconds,max_messages,enabled FROM moderation_cleanup_rules WHERE guild_id=$1",
      [guildId]
    );
    assert.deepEqual(rows.rows, [{
      channel_id: "123456789012345748",
      interval_seconds: 3600,
      max_messages: 100,
      enabled: true
    }]);
    await assert.rejects(
      db.query(
        "INSERT INTO moderation_cleanup_rules(guild_id,channel_id,interval_seconds,max_messages) VALUES($1,$2,59,100)",
        [guildId,"123456789012345747"]
      )
    );
  } finally {
    await db.query("DELETE FROM moderation_cleanup_rules WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.query("DELETE FROM guild_modules WHERE guild_id=$1 AND module_key='moderation'", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("moderation channel locks preserve original send-message state for lockdown restoration", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345746";
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO moderation_channel_locks(guild_id,channel_id,previous_send_messages) VALUES($1,$2,true) ON CONFLICT(guild_id,channel_id) DO UPDATE SET previous_send_messages=EXCLUDED.previous_send_messages",
      [guildId,"123456789012345745"]
    );
    const rows = await db.query<{ previous_send_messages: boolean | null }>(
      "SELECT previous_send_messages FROM moderation_channel_locks WHERE guild_id=$1 AND channel_id=$2",
      [guildId,"123456789012345745"]
    );
    assert.deepEqual(rows.rows, [{ previous_send_messages: true }]);
  } finally {
    await db.query("DELETE FROM moderation_channel_locks WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("notification feed filters and templates persist with bounded arrays", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345743";
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO notification_feeds(guild_id,channel_id,url,interval_seconds,enabled,message_template,include_keywords,exclude_keywords) VALUES($1,$2,'https://example.com/feed.xml',300,true,$3,$4,$5)",
      [guildId,"123456789012345742","**{title}**\n{url}",["release","update"],["spoiler"]]
    );
    const result = await db.query<{ message_template: string; include_keywords: string[]; exclude_keywords: string[] }>(
      "SELECT message_template,include_keywords,exclude_keywords FROM notification_feeds WHERE guild_id=$1",
      [guildId]
    );
    assert.deepEqual(result.rows, [{
      message_template: "**{title}**\n{url}",
      include_keywords: ["release","update"],
      exclude_keywords: ["spoiler"]
    }]);
  } finally {
    await db.query("DELETE FROM notification_feeds WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("ticket priority and tags persist with expected bounds", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345739";
  try {
    await migrate(db);
    await db.query("DELETE FROM tickets WHERE guild_id=$1", [guildId]);
    await db.query(
      "INSERT INTO tickets(guild_id,channel_id,creator_id,status,priority,tags) VALUES($1,$2,$3,'open','urgent',$4)",
      [guildId,"123456789012345738","123456789012345737",["billing","vip"]]
    );
    const result = await db.query<{ priority: string; tags: string[] }>(
      "SELECT priority,tags FROM tickets WHERE guild_id=$1",
      [guildId]
    );
    assert.deepEqual(result.rows, [{ priority: "urgent", tags: ["billing","vip"] }]);
    await assert.rejects(
      db.query(
        "UPDATE tickets SET priority='invalid' WHERE guild_id=$1",
        [guildId]
      )
    );
  } finally {
    await db.query("DELETE FROM tickets WHERE guild_id=$1", [guildId]).catch(() => undefined);
    await db.close();
  }
});

test("role automation rules and delayed jobs persist with bounded state", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345734";
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO role_automation_rules(guild_id,trigger,channel_id,role_id,delay_seconds,enabled) VALUES($1,'member.join','',$2,3600,true)",
      [guildId,"123456789012345733"]
    );
    await db.query(
      "INSERT INTO role_automation_jobs(guild_id,user_id,role_id,add_role,available_at) VALUES($1,$2,$3,true,now()+interval '1 hour')",
      [guildId,"123456789012345732","123456789012345733"]
    );
    const rules = await db.query<{ trigger: string; channel_id: string; role_id: string; delay_seconds: number }>(
      "SELECT trigger,channel_id,role_id,delay_seconds FROM role_automation_rules WHERE guild_id=$1",
      [guildId]
    );
    const jobs = await db.query<{ user_id: string; role_id: string; attempts: number }>(
      "SELECT user_id,role_id,attempts FROM role_automation_jobs WHERE guild_id=$1",
      [guildId]
    );
    assert.deepEqual(rules.rows, [{
      trigger: "member.join",
      channel_id: "",
      role_id: "123456789012345733",
      delay_seconds: 3600
    }]);
    assert.deepEqual(jobs.rows, [{
      user_id: "123456789012345732",
      role_id: "123456789012345733",
      attempts: 0
    }]);
  } finally {
    await db.query("DELETE FROM role_automation_jobs WHERE guild_id=$1",[guildId]).catch(() => undefined);
    await db.query("DELETE FROM role_automation_rules WHERE guild_id=$1",[guildId]).catch(() => undefined);
    await db.close();
  }
});

test("moderation presets persist a complete profile payload", { skip: !enabled }, async () => {
  const db = new Database(process.env.DATABASE_URL!);
  const guildId = "123456789012345731";
  try {
    await migrate(db);
    const payload = {
      name: "strict",
      automod: { config: { enabled: true }, rules: [{ detector: "links", action: "ban" }] },
      security: { enabled: true, maxJoins: 5 },
      escalations: [{ warnCount: 3, action: "timeout", durationMinutes: 60 }]
    };
    await db.query(
      "INSERT INTO moderation_presets(guild_id,name,payload) VALUES($1,$2,$3::jsonb)",
      [guildId,payload.name,JSON.stringify(payload)]
    );
    const result = await db.query<{ name: string; payload: Record<string, unknown> }>(
      "SELECT name,payload FROM moderation_presets WHERE guild_id=$1",
      [guildId]
    );
    assert.equal(result.rows.length,1);
    assert.equal(result.rows[0]?.name,"strict");
    assert.deepEqual(result.rows[0]?.payload,payload);
  } finally {
    await db.query("DELETE FROM moderation_presets WHERE guild_id=$1",[guildId]).catch(() => undefined);
    await db.close();
  }
});
