import dns from "node:dns/promises";
import net from "node:net";
import { XMLParser } from "fast-xml-parser";
import { EmbedBuilder, ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type NotificationEmbedConfig = {
  title?: string;
  description?: string;
  url?: string;
  color?: string;
  footer?: string;
  image?: string;
  thumbnail?: string;
};

export type NotificationFeedRecord = {
  id: number;
  guildId: string;
  channelId: string;
  url: string;
  enabled: boolean;
  intervalSeconds: number;
  lastItemKey: string | null;
  lastPolledAt: string | null;
  messageTemplate: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  embedConfig: NotificationEmbedConfig | null;
};

type Feed = {
  id: string;
  guildId: string;
  channelId: string;
  url: string;
  intervalSeconds: number;
  lastItemKey: string | null;
  messageTemplate: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  embedConfig: NotificationEmbedConfig | null;
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
      message_template: string;
      include_keywords: string[];
      exclude_keywords: string[];
      embed_config: NotificationEmbedConfig | null;
    }>(
      "SELECT id,guild_id,channel_id,url,enabled,interval_seconds,last_item_key,last_polled_at,message_template,include_keywords,exclude_keywords,embed_config FROM notification_feeds WHERE guild_id=$1 ORDER BY id DESC",
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
      lastPolledAt: row.last_polled_at,
      messageTemplate: row.message_template,
      includeKeywords: Array.isArray(row.include_keywords) ? row.include_keywords : [],
      excludeKeywords: Array.isArray(row.exclude_keywords) ? row.exclude_keywords : [],
      embedConfig: normalizeNotificationEmbedConfig(row.embed_config)
    }));
  }

  async addFeed(
    guildId: string,
    channelId: string,
    url: string,
    intervalSeconds: number,
    options: {
      messageTemplate?: string;
      includeKeywords?: string[];
      excludeKeywords?: string[];
      embedConfig?: NotificationEmbedConfig | null;
    } = {}
  ): Promise<NotificationFeedRecord> {
    await assertSafeFeedUrl(url);
    const safeInterval = Math.min(Math.max(Math.trunc(intervalSeconds), 60), 86_400);
    const messageTemplate = normalizeFeedTemplate(options.messageTemplate);
    const includeKeywords = normalizeKeywords(options.includeKeywords);
    const excludeKeywords = normalizeKeywords(options.excludeKeywords);
    const embedConfig = options.embedConfig ? await normalizeNotificationEmbedConfig(options.embedConfig) : null;
    const result = await this.db.query<{ id: string }>(
      "INSERT INTO notification_feeds(guild_id,channel_id,url,interval_seconds,enabled,message_template,include_keywords,exclude_keywords,embed_config) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8::jsonb) RETURNING id",
      [guildId, channelId, url, safeInterval, messageTemplate, includeKeywords, excludeKeywords, embedConfig ? JSON.stringify(embedConfig) : null]
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

  async addSocialFeed(
    guildId: string,
    provider: "reddit" | "youtube" | "mastodon",
    target: string,
    channelId: string,
    intervalSeconds: number,
    options: {
      messageTemplate?: string;
      includeKeywords?: string[];
      excludeKeywords?: string[];
      embedConfig?: NotificationEmbedConfig | null;
    } = {}
  ): Promise<NotificationFeedRecord> {
    const url = buildSocialFeedUrl(provider, target);
    return this.addFeed(guildId, channelId, url, intervalSeconds, options);
  }

  async updateFeed(guildId: string, id: number, patch: {
    channelId?: string;
    url?: string;
    intervalSeconds?: number;
    enabled?: boolean;
    messageTemplate?: string;
    includeKeywords?: string[];
    excludeKeywords?: string[];
    embedConfig?: NotificationEmbedConfig | null;
  }): Promise<boolean> {
    if (patch.url !== undefined) await assertSafeFeedUrl(patch.url);
    const current = (await this.listFeeds(guildId)).find((item) => item.id === id);
    if (!current) return false;
    const embedConfig = patch.embedConfig !== undefined
      ? (patch.embedConfig ? await normalizeNotificationEmbedConfig(patch.embedConfig) : null)
      : current.embedConfig;
    await this.db.query(
      `UPDATE notification_feeds
       SET channel_id=$1,url=$2,interval_seconds=$3,enabled=$4,
           message_template=$5,include_keywords=$6,exclude_keywords=$7,embed_config=$8::jsonb,updated_at=now()
       WHERE id=$9 AND guild_id=$10`,
      [
        patch.channelId ?? current.channelId,
        patch.url ?? current.url,
        Math.min(Math.max(Math.trunc(patch.intervalSeconds ?? current.intervalSeconds), 60), 86_400),
        patch.enabled ?? current.enabled,
        patch.messageTemplate !== undefined ? normalizeFeedTemplate(patch.messageTemplate) : current.messageTemplate,
        patch.includeKeywords !== undefined ? normalizeKeywords(patch.includeKeywords) : current.includeKeywords,
        patch.excludeKeywords !== undefined ? normalizeKeywords(patch.excludeKeywords) : current.excludeKeywords,
        embedConfig ? JSON.stringify(embedConfig) : null,
        id,
        guildId
      ]
    );
    return true;
  }

  async setFeedEnabled(guildId: string, id: number, enabled: boolean): Promise<boolean> {
    const current = (await this.listFeeds(guildId)).find((feed) => feed.id === id);
    if (!current) return false;
    await this.db.query(
      "UPDATE notification_feeds SET enabled=$1,updated_at=now() WHERE id=$2 AND guild_id=$3",
      [enabled,id,guildId]
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
    if (sub === "github") {
      const repo = interaction.options.getString("repo", true).trim();
      const type = interaction.options.getString("type", true);
      const channelOption = interaction.options.getChannel("channel", true);
      const channel = interaction.guild!.channels.cache.get(channelOption.id);
      const minutes = interaction.options.getInteger("minutes") ?? 5;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Channel должен быть текстовым.", ephemeral: true });
        return;
      }
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        await interaction.reply({ content: "Repo должен быть в формате owner/repository.", ephemeral: true });
        return;
      }
      const feedPath = type === "releases" ? "releases.atom" : "commits.atom";
      const url = "https://github.com/" + repo + "/" + feedPath;
      await this.addFeed(interaction.guild!.id, channel.id, url, minutes * 60);
      await interaction.reply({ content: "GitHub feed добавлен: " + repo + " (" + type + ").", ephemeral: true });
      return;
    }

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
        `UPDATE notification_feeds nf
         SET processing_until=now()+interval '2 minutes'
         FROM (
           SELECT nf2.id
           FROM notification_feeds nf2
           INNER JOIN guild_bot_assignments ga
             ON ga.guild_id=nf2.guild_id
           WHERE nf2.enabled=true
             AND (
               ga.bot_identity_id=$1
               OR (
                 $1='primary'
                 AND ga.bot_identity_id <> 'primary'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM bot_heartbeats bh
                   WHERE bh.bot_identity_id=ga.bot_identity_id
                     AND bh.last_seen_at >= now()-interval '90 seconds'
                 )
               )
             )
             AND (nf2.processing_until IS NULL OR nf2.processing_until < now())
             AND (nf2.last_polled_at IS NULL OR nf2.last_polled_at <= now() - make_interval(secs => nf2.interval_seconds))
           ORDER BY nf2.last_polled_at NULLS FIRST
           LIMIT 20
           FOR UPDATE SKIP LOCKED
         ) claim
         WHERE nf.id=claim.id
         RETURNING nf.id,nf.guild_id AS "guildId",nf.channel_id AS "channelId",nf.url,
                   nf.interval_seconds AS "intervalSeconds",nf.last_item_key AS "lastItemKey",
                   nf.message_template AS "messageTemplate",
                   nf.include_keywords AS "includeKeywords",
                   nf.exclude_keywords AS "excludeKeywords",
                   nf.embed_config AS "embedConfig"`,
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

    const title = first.title.toLocaleLowerCase();
    const matchesInclude = feed.includeKeywords.length === 0 ||
      feed.includeKeywords.some((keyword) => title.includes(keyword.toLocaleLowerCase()));
    const matchesExclude = feed.excludeKeywords.some((keyword) => title.includes(keyword.toLocaleLowerCase()));
    if (!matchesInclude || matchesExclude) {
      await this.db.query(
        "UPDATE notification_feeds SET last_item_key=$1,last_polled_at=now(),processing_until=NULL WHERE id=$2",
        [first.key, feed.id]
      );
      return;
    }

    const channel = this.client?.channels.cache.get(feed.channelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      await this.markPolled(feed.id, "destination unavailable");
      return;
    }

    try {
      const content = renderFeedTemplate(feed.messageTemplate, first);
      const embed = buildNotificationEmbed(feed.embedConfig, first);
      await channel.send({
        content: content || undefined,
        embeds: embed ? [embed] : undefined
      });
    } catch (error) {
      logger.warn("Feed message failed", { feedId: feed.id, error: String(error) });
      await this.markPolled(feed.id, "destination send failed");
      return;
    }

    await this.db.query(
      "UPDATE notification_feeds SET last_item_key=$1,last_polled_at=now(),processing_until=NULL WHERE id=$2",
      [first.key, feed.id]
    );
  }

  private async markPolled(id: string, _error: string | null): Promise<void> {
    await this.db.query(
      "UPDATE notification_feeds SET last_polled_at=now(),processing_until=NULL WHERE id=$1",
      [id]
    );
  }
}

export function normalizeNotificationEmbedConfig(value?: NotificationEmbedConfig | null): NotificationEmbedConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const result: NotificationEmbedConfig = {};
  const copy = (key: keyof NotificationEmbedConfig, max: number) => {
    const raw = input[key];
    if (typeof raw !== "string") return;
    const normalized = raw.trim().slice(0, max);
    if (normalized) result[key] = normalized;
  };

  copy("title", 256);
  copy("description", 4096);
  copy("footer", 2048);
  copy("url", 2000);
  copy("image", 2000);
  copy("thumbnail", 2000);
  copy("color", 7);

  if (result.color && !/^#[0-9a-fA-F]{6}$/.test(result.color)) delete result.color;
  return Object.keys(result).length ? result : null;
}

export function buildNotificationEmbed(
  config: NotificationEmbedConfig | null,
  entry: { title: string; url: string }
): EmbedBuilder | null {
  if (!config) return null;
  const replace = (value: string) =>
    value
      .replaceAll("{title}", entry.title.slice(0, 250))
      .replaceAll("{url}", entry.url.slice(0, 1800))
      .replaceAll("{timestamp}", new Date().toISOString());

  const embed = new EmbedBuilder();
  if (config.title) embed.setTitle(replace(config.title));
  if (config.description) embed.setDescription(replace(config.description));
  if (config.url) embed.setURL(config.url);
  if (config.color) embed.setColor(config.color);
  if (config.footer) embed.setFooter({ text: replace(config.footer) });
  if (config.image) embed.setImage(config.image);
  if (config.thumbnail) embed.setThumbnail(config.thumbnail);

  return Object.keys(embed.data).length ? embed : null;
}

function normalizeFeedTemplate(value?: string): string {
  const template = String(value ?? "📡 **Новая запись из feed**\n**{title}**\n{url}").trim().slice(0, 1800);
  return template || "📡 **Новая запись из feed**\n**{title}**\n{url}";
}

export function buildSocialFeedUrl(
  provider: "reddit" | "youtube" | "mastodon",
  target: string
): string {
  const value = target.trim();
  if (provider === "reddit") {
    const subreddit = value.replace(/^r\//i, "").replace(/^https?:\/\/www\.reddit\.com\/r\//i, "").replace(/\/$/, "");
    if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) throw new Error("invalid_reddit_target");
    return "https://www.reddit.com/r/" + subreddit + "/new/.rss";
  }

  if (provider === "youtube") {
    const match = value.match(/(?:youtube\.com\/channel\/|^)(UC[\w-]{20,40})$/i);
    if (!match) throw new Error("invalid_youtube_channel");
    return "https://www.youtube.com/feeds/videos.xml?channel_id=" + match[1];
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
  } catch {
    throw new Error("invalid_mastodon_target");
  }
  if (url.protocol !== "https:" || !/^\/\@[A-Za-z0-9_\-\.]+$/.test(url.pathname.replace(/\.rss$/, ""))) {
    throw new Error("invalid_mastodon_target");
  }
  return url.origin + url.pathname.replace(/\.rss$/, "") + ".rss";
}

export function normalizeKeywords(values?: string[]): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value).trim().toLocaleLowerCase())
    .filter(Boolean)
    .slice(0, 20)
    .map((value) => value.slice(0, 80)))];
}

export function renderFeedTemplate(template: string, entry: { title: string; url: string }): string {
  return template
    .replaceAll("{title}", entry.title.slice(0, 250))
    .replaceAll("{url}", entry.url.slice(0, 1800))
    .replaceAll("{timestamp}", new Date().toISOString())
    .slice(0, 2000);
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

export async function assertSafeFeedUrl(raw: string): Promise<void> {
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
