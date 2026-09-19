import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { Database } from "./database.js";
import { ConfigTransferService } from "./config-transfer.js";
import { logger } from "./logger.js";

export type BackupRemoteConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export class BackupService {
  private readonly s3?: S3Client;
  private readonly remote?: BackupRemoteConfig;

  constructor(
    private readonly db: Database,
    private readonly directory: string,
    private readonly retentionCount = 30,
    remote?: BackupRemoteConfig
  ) {
    this.remote = remote;
    if (remote) {
      this.s3 = new S3Client({
        endpoint: remote.endpoint,
        region: remote.region,
        forcePathStyle: remote.forcePathStyle,
        credentials: {
          accessKeyId: remote.accessKeyId,
          secretAccessKey: remote.secretAccessKey
        }
      });
    }
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async createGuildBackup(guildId: string): Promise<string> {
    await this.ensureDirectory();
    const payload = await new ConfigTransferService(this.db).exportGuild(guildId);
    const filename = `guild-${guildId}-${Date.now()}.json.gz`;
    const target = join(this.directory, filename);

    await pipeline(
      Readable.from([JSON.stringify(payload)]),
      createGzip({ level: 9 }),
      createWriteStream(target, { flags: "wx", mode: 0o600 })
    );

    await this.uploadRemote(filename, target);
    await this.pruneGuildBackups(guildId);
    return target;
  }

  async restoreGuildBackup(targetGuildId: string, file: string): Promise<void> {
    const safe = this.safeBackupName(file);
    if (!this.belongsToGuild(safe, targetGuildId)) throw new Error("backup_guild_mismatch");
    const path = join(this.directory, safe);

    let raw: string;
    try {
      raw = await readGzip(path);
    } catch (error) {
      if (!this.s3 || !isNotFound(error)) throw error;
      raw = await this.readRemoteGzip(safe);
    }

    await new ConfigTransferService(this.db).importGuild(targetGuildId, JSON.parse(raw));
  }

  async listBackups(guildId?: string): Promise<string[]> {
    await this.ensureDirectory();
    const local = await readdir(this.directory);
    const result = new Set(
      local
        .filter((entry) => /^guild-\d{17,20}-\d+\.json\.gz$/.test(entry))
        .filter((entry) => !guildId || entry.startsWith("guild-" + guildId + "-"))
    );

    if (this.s3 && this.remote) {
      try {
        let token: string | undefined;
        do {
          const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.remote.bucket,
          Prefix: this.remotePrefix(guildId),
          ContinuationToken: token
        }));
        const prefixLength = this.remote.prefix ? this.remote.prefix.length + 1 : 0;
        for (const object of response.Contents ?? []) {
          if (!object.Key) continue;
          const name = object.Key.slice(prefixLength);
          if (/^guild-\d{17,20}-\d+\.json\.gz$/.test(name)) result.add(name);
        }
          token = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (token);
      } catch (error) {
        logger.warn("Remote backup listing failed; local backups retained", { error: String(error) });
      }
    }

    return [...result].sort().reverse();
  }

  async deleteBackup(file: string, guildId?: string): Promise<void> {
    const safe = this.safeBackupName(file);
    if (guildId && !this.belongsToGuild(safe, guildId)) throw new Error("backup_guild_mismatch");
    await unlink(join(this.directory, safe)).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
    await this.deleteRemote(safe);
  }

  async readBackup(file: string, guildId?: string): Promise<unknown> {
    const safe = this.safeBackupName(file);
    if (guildId && !this.belongsToGuild(safe, guildId)) throw new Error("backup_guild_mismatch");

    let raw: string;
    try {
      raw = await readGzip(join(this.directory, safe));
    } catch (error) {
      if (!this.s3 || !isNotFound(error)) throw error;
      raw = await this.readRemoteGzip(safe);
    }
    return JSON.parse(raw);
  }

  private async uploadRemote(filename: string, path: string): Promise<void> {
    if (!this.s3 || !this.remote) return;
    try {
      const fs = await import("node:fs/promises");
      const body = await fs.readFile(path);
      await this.s3.send(new PutObjectCommand({
        Bucket: this.remote.bucket,
        Key: this.remoteKey(filename),
        Body: body,
        ContentType: "application/gzip"
      }));
    } catch (error) {
      logger.warn("Remote backup upload failed; local backup retained", { filename, error: String(error) });
    }
  }

  private async readRemoteGzip(filename: string): Promise<string> {
    if (!this.s3 || !this.remote) throw new Error("remote_backup_unavailable");
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.remote.bucket,
      Key: this.remoteKey(filename)
    }));
    if (!response.Body) throw new Error("remote_backup_empty");
    const bytes = await response.Body.transformToByteArray();
    return gunzipBuffer(Buffer.from(bytes)).toString();
  }

  private async deleteRemote(filename: string): Promise<void> {
    if (!this.s3 || !this.remote) return;
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.remote.bucket,
      Key: this.remoteKey(filename)
    })).catch((error) => {
      if (!isNotFound(error)) logger.warn("Remote backup delete failed", { filename, error: String(error) });
    });
  }

  private async pruneGuildBackups(guildId: string): Promise<void> {
    const entries = await readdir(this.directory);
    const backups = entries
      .filter((entry) => /^guild-\\d{17,20}-\\d+\\.json\\.gz$/.test(entry))
      .filter((entry) => entry.startsWith("guild-" + guildId + "-"))
      .sort()
      .reverse();
    for (const filename of backups.slice(this.retentionCount)) {
      await unlink(join(this.directory, filename)).catch(() => undefined);
      if (this.s3 && this.remote) {
        await this.s3.send(new DeleteObjectCommand({
          Bucket: this.remote.bucket,
          Key: this.remoteKey(filename)
        })).catch((error) => logger.warn("Remote backup retention cleanup failed", { filename, error: String(error) }));
      }
    }
  }

  private safeBackupName(file: string): string {
    const safe = basename(file);
    if (!/^guild-\d{17,20}-\d+\.json\.gz$/.test(safe)) throw new Error("invalid_backup_name");
    return safe;
  }

  private belongsToGuild(file: string, guildId: string): boolean {
    return file.startsWith("guild-" + guildId + "-");
  }

  private remoteKey(filename: string): string {
    return this.remote?.prefix ? this.remote.prefix + "/" + filename : filename;
  }

  private remotePrefix(guildId?: string): string {
    const prefix = this.remote?.prefix ? this.remote.prefix + "/" : "";
    return prefix + (guildId ? "guild-" + guildId + "-" : "");
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

async function gunzipBuffer(input: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const gunzip = createGunzip();
  gunzip.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await pipeline(Readable.from([input]), gunzip);
  return Buffer.concat(chunks);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && (error as { name?: unknown }).name === "NoSuchKey") return true;
  if ("code" in error && (error as { code?: unknown }).code === "ENOENT") return true;
  if ("$metadata" in error) {
    return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
  }
  return false;
}
