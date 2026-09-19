import { createReadStream, createWriteStream } from "node:fs";
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
      ReadableFromJson(JSON.stringify(payload)),
      createGzip({ level: 9 }),
      createWriteStream(target, { flags: "wx", mode: 0o600 })
    );

    return target;
  }

  async restoreGuildBackup(targetGuildId: string, file: string): Promise<void> {
    const path = join(this.directory, basename(file));
    const raw = await readGzip(path);
    const payload = JSON.parse(raw) as unknown;
    await new ConfigTransferService(this.db).importGuild(targetGuildId, payload);
  }

  async listBackups(): Promise<string[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.directory);
    return entries.filter((entry) => /^guild-\d{17,20}-\d+\.json\.gz$/.test(entry)).sort().reverse();
  }

  async deleteBackup(file: string): Promise<void> {
    const safe = basename(file);
    if (!/^guild-\d{17,20}-\d+\.json\.gz$/.test(safe)) {
      throw new Error("invalid_backup_name");
    }
    await unlink(join(this.directory, safe));
  }

  async readBackup(file: string): Promise<unknown> {
    const safe = basename(file);
    if (!/^guild-\d{17,20}-\d+\.json\.gz$/.test(safe)) {
      throw new Error("invalid_backup_name");
    }
    return JSON.parse(await readGzip(join(this.directory, safe)));
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

function ReadableFromJson(value: string) {
  return import("node:stream").then(({ Readable }) => Readable.from([value]));
}
