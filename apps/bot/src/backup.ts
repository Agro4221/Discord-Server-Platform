import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import type { Database } from "./database.js";
import { ConfigTransferService } from "./config-transfer.js";

export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly directory: string
  ) {}

  async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async createGuildBackup(guildId: string): Promise<string> {
    await this.ensureDirectory();

    const transfer = new ConfigTransferService(this.db);
    const payload = await transfer.exportGuild(guildId);

    const filename = `guild-${guildId}-${Date.now()}.json.gz`;
    const target = join(this.directory, filename);

    await pipeline(
      Readable.from([JSON.stringify(payload)]),
      createGzip({ level: 9 }),
      createWriteStream(target, { flags: "wx", mode: 0o600 })
    );

    return target;
  }

  async restoreGuildBackup(targetGuildId: string, file: string): Promise<void> {
    const safe = this.safeBackupName(file);
    if (!this.belongsToGuild(safe, targetGuildId)) throw new Error("backup_guild_mismatch");
    const path = join(this.directory, safe);
    const raw = await readGzip(path);
    const payload = JSON.parse(raw) as unknown;
    await new ConfigTransferService(this.db).importGuild(targetGuildId, payload);
  }

  async listBackups(guildId?: string): Promise<string[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.directory);
    return entries
      .filter((entry) => /^guild-\d{17,20}-\d+\.json\.gz$/.test(entry))
      .filter((entry) => !guildId || entry.startsWith("guild-" + guildId + "-"))
      .sort()
      .reverse();
  }

  async deleteBackup(file: string, guildId?: string): Promise<void> {
    const safe = this.safeBackupName(file);
    if (guildId && !this.belongsToGuild(safe, guildId)) throw new Error("backup_guild_mismatch");
    await unlink(join(this.directory, safe));
  }

  async readBackup(file: string, guildId?: string): Promise<unknown> {
    const safe = this.safeBackupName(file);
    if (guildId && !this.belongsToGuild(safe, guildId)) throw new Error("backup_guild_mismatch");
    return JSON.parse(await readGzip(join(this.directory, safe)));
  }

  private safeBackupName(file: string): string {
    const safe = basename(file);
    if (!/^guild-\d{17,20}-\d+\.json\.gz$/.test(safe)) {
      throw new Error("invalid_backup_name");
    }
    return safe;
  }

  private belongsToGuild(file: string, guildId: string): boolean {
    return file.startsWith("guild-" + guildId + "-");
  }
}

async function readGzip(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  const source = createReadStream(path);
  const gunzip = createGunzip();

  gunzip.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await pipeline(source, gunzip);
  return Buffer.concat(chunks).toString("utf8");
}

