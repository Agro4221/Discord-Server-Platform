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
        "bot_identities","guild_bot_assignments","bot_heartbeats","music_node_sessions"
      ]]
    );
    assert.equal(tables.rows.length, 8);
  } finally {
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
