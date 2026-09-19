import dns from "node:dns/promises";
import net from "node:net";
import { XMLParser } from "fast-xml-parser";
import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type NotificationFeedRecord = {
  id: number;
  guildId: string;
  channelId: string;
  url: string;
  enabled: boolean;
  intervalSeconds: number;
  lastItemKey: string | null;
  lastPolledAt: string | null;
};

type Feed = {
  id: string;
  guildId: string;
  channelId: string;
  url: string;
  intervalSeconds: number;
  lastItemKey: string | null;
};

export class Notifications implements PlatformModule {
  readonly name = "notifications";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: Client;
  private running = false;
  private identityId = "primary";

  constructor(private readonly db: Database) {}

  async listFeeds(guildId: string): Promise<NotificationFeedRecord[]> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      url: string;
      enabled: boolean;
      interval_seconds: number;
      last_item_key: string | null;
      last_polled_at: string | null;
    }>(
      "SELECT id,guild_id,channel_id,url,enabled,interval_seconds,last_item_key,last_polled_at FROM notification_feeds WHERE guild_id=$1 ORDER BY id DESC",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      url: row.url,
      enabled: row.enabled,
      intervalSeconds: row.interval_seconds,
      lastItemKey: row.last_item_key,
      lastPolledAt: row.last_polled_at
    }));
  }

  async addFeed(guildId: string, channelId: string, url: string, intervalSeconds: number): Promise<NotificationFeedRecord> {
    await assertSafeFeedUrl(url);
    const safeInterval = Math.min(Math.max(Math.trunc(intervalSeconds), 60), 86_400);
    const result = await this.db.query<{ id: string }>(
      "INSERT INTO notification_feeds(guild_id,channel_id,url,interval_seconds,enabled) VALUES($1,$2,$3,$4,true) RETURNING id",
      [guildId, channelId, url, safeInterval]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("feed_create_failed");
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'notifications',true)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );
    const feed = (await this.listFeeds(guildId)).find((item) => item.id === Number(id));
    if (!feed) throw new Error("feed_create_failed");
    return feed;
  }

  async updateFeed(guildId: string, id: number, patch: { channelId?: string; url?: string; intervalSeconds?: number; enabled?: boolean }): Promise<boolean> {
    if (patch.url !== undefined) await assertSafeFeedUrl(patch.url);
    const current = (await this.listFeeds(guildId)).find((item) => item.id === id);
    if (!current) return false;
    await this.db.query(
      `UPDATE notification_feeds
       SET channel_id=$1,url=$2,interval_seconds=$3,enabled=$4,updated_at=now()
       WHERE id=$5 AND guild_id=$6`,
      [
        patch.channelId ?? current.channelId,
        patch.url ?? current.url,
        Math.min(Math.max(Math.trunc(patch.intervalSeconds ?? current.intervalSeconds), 60), 86_400),
        patch.enabled ?? current.enabled,
        id,
        guildId
      ]
    );
    return true;
  }

  async deleteFeed(guildId: string, id: number): Promise<boolean> {
    const result = await this.db.query("DELETE FROM notification_feeds WHERE id=$1 AND guild_id=$2", [id,guildId]);
    return result.rowCount === 1;
  }

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.identityId = context.identityId;
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.timer = setInterval(() => void this.pollAll(), 30_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "feed") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "notifications", false)) {
      await interaction.reply({ content: "Модуль Notifications выключен.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "add") {
      const url = interaction.options.getString("url", true);
      const channelOption = interaction.options.getChannel("channel", true);
      const channel = interaction.guild!.channels.cache.get(channelOption.id);
      const minutes = interaction.options.getInteger("minutes") ?? 5;

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Channel должен быть текстовым.", ephemeral: true });
        return;
      }

      await this.addFeed(interaction.guild!.id, channel.id, url, minutes * 60);
      await interaction.reply({ content: "Feed добавлен. Проверка начнётся автоматически.", ephemeral: true });
    }
  }

  private async pollAll(): Promise<void> {
    if (this.running || !this.client) return;
    this.running = true;

    try {
      const feeds = await this.db.query<Feed>(
        `SELECT nf.id,nf.guild_id AS "guildId",nf.channel_id AS "channelId",nf.url,
                nf.interval_seconds AS "intervalSeconds",nf.last_item_key AS "lastItemKey"
         FROM notification_feeds nf
         INNER JOIN guild_bot_assignments ga
           ON ga.guild_id=nf.guild_id
         LEFT JOIN bot_heartbeats bh
           ON bh.bot_identity_id=ga.bot_identity_id
         WHERE nf.enabled=true
           AND (ga.bot_identity_id=$1 OR ($1='primary' AND ga.bot_identity_id <> 'primary' AND bh.last_seen_at < now()-interval '90 seconds'))
           AND (nf.last_polled_at IS NULL OR nf.last_polled_at <= now() - make_interval(secs => nf.interval_seconds))
         ORDER BY nf.last_polled_at NULLS FIRST
         LIMIT 20`,
        [this.identityId]
      );

      for (const feed of feeds.rows) {
        await this.poll(feed);
      }
    } finally {
      this.running = false;
    }
  }

  private async poll(feed: Feed): Promise<void> {
    await assertSafeFeedUrl(feed.url);

    const response = await fetch(feed.url, {
      headers: {
        "user-agent": "DiscordServerPlatform/0.1 (+self-hosted feed poller)"
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      await this.markPolled(feed.id, `HTTP ${response.status}`);
      return;
    }

    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 2_000_000) {
      await this.markPolled(feed.id, "response too large");
      return;
    }

    const xml = await response.text();
    if (xml.length > 2_000_000) {
      await this.markPolled(feed.id, "response too large");
      return;
    }

    const parser = new XMLParser({
      ignoreAttributes: true,
      processEntities: false,
      removeNSPrefix: true,
      parseTagValue: true,
      trimValues: true
    });

    const document = parser.parse(xml) as Record<string, any>;
    const entries = normalizeFeedEntries(document);
    const first = entries[0];
    if (!first) {
      await this.markPolled(feed.id, null);
      return;
    }

    if (feed.lastItemKey === first.key) {
      await this.markPolled(feed.id, null);
      return;
    }

    const channel = this.client?.channels.cache.get(feed.channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      await this.markPolled(feed.id, "destination unavailable");
      return;
    }

    try {
      await channel.send(
        `📡 **Новая запись из feed**
**${first.title.slice(0, 250)}**
${first.url}`
      );
    } catch (error) {
      logger.warn("Feed message failed", { feedId: feed.id, error: String(error) });
      await this.markPolled(feed.id, "destination send failed");
      return;
    }

    await this.db.query(
      "UPDATE notification_feeds SET last_item_key=$1,last_polled_at=now() WHERE id=$2",
      [first.key, feed.id]
    );
  }

  private async markPolled(id: string, _error: string | null): Promise<void> {
    await this.db.query("UPDATE notification_feeds SET last_polled_at=now() WHERE id=$1", [id]);
  }
}

function normalizeFeedEntries(document: Record<string, any>): { key: string; title: string; url: string }[] {
  const rss = document.rss?.channel?.item;
  const atom = document.feed?.entry;

  const raw = Array.isArray(rss) ? rss : rss ? [rss] : Array.isArray(atom) ? atom : atom ? [atom] : [];

  return raw.map((item: any, index: number) => {
    const title = String(item.title ?? item.name ?? "Без названия");
    const url =
      typeof item.link === "string"
        ? item.link
        : typeof item.link?.href === "string"
          ? item.link.href
          : String(item.guid ?? item.id ?? index);

    return {
      key: String(item.guid ?? item.id ?? url),
      title,
      url
    };
  });
}

async function assertSafeFeedUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_feed_url");
  }

  if (url.protocol !== "https:") throw new Error("feed_must_use_https");
  if (url.username || url.password) throw new Error("feed_credentials_not_allowed");

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("private_hostname_not_allowed");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("private_ip_not_allowed");
    throw new Error("literal_ip_not_allowed");
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("hostname_resolves_to_private_ip");
  }
}

export function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const a = parts[0];
    const b = parts[1];
    if (a === undefined || b === undefined) return false;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && b !== undefined && b >= 18 && b <= 19)
    ) return true;
    return a >= 224;
  }

  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff")
  ) {
    return true;
  }

  const mappedPrefix = "::ffff:";
  if (normalized.startsWith(mappedPrefix)) {
    const mappedValue = normalized.slice(mappedPrefix.length);
    const mapped = mappedValue.split(".").length === 4
      ? mappedValue
      : ipv4FromMappedHex(mappedValue);
    return net.isIPv4(mapped) ? isPrivateIp(mapped) : false;
  }

  return false;
}

function ipv4FromMappedHex(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 2) return "";
  const first = Number.parseInt(parts[0] ?? "", 16);
  const second = Number.parseInt(parts[1] ?? "", 16);
  if (!Number.isInteger(first) || !Number.isInteger(second)) return "";
  return [
    (first >> 8) & 255,
    first & 255,
    (second >> 8) & 255,
    second & 255
  ].join(".");
}
