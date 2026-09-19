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
        "bot_identities","guild_bot_assignments","bot_heartbeats","music_node_sessions","guild_music_bot_assignments"
      ]]
    );
    assert.equal(tables.rows.length, 9);
    assert.equal(first.rows[0]?.count, "20");
  } finally {
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
