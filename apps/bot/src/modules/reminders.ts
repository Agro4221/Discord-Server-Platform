import type { ChatInputCommandInteraction, Client, Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type AfkRecord = {
  userId: string;
  reason: string;
  sinceAt: Date;
};

export class Reminders implements PlatformModule {
  readonly name = "reminders";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: Client;
  private running = false;
  private identityId = "primary";
  private readonly sticky = new Map<string, { guildId: string; channelId: string; content: string; messageId: string | null }>();
  private readonly stickyBusy = new Set<string>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.identityId = context.identityId;
    await this.loadSticky();
    const commandUnsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const messageUnsubscribe = context.events.on("message.create", (message) => {
      if (!message.guild || message.author.bot) return;
      void this.handleMessageActivity(message);
      void this.refreshSticky(message.guild.id, message.channelId);
    });
    this.unsubscribe = () => { commandUnsubscribe(); messageUnsubscribe(); };
    this.timer = setInterval(() => void this.deliver(), 5_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
    this.running = false;
    this.sticky.clear();
    this.stickyBusy.clear();
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot || !["remind","schedule","sticky","afk"].includes(commandName)) return false;
    if (!await moduleEnabled(this.db, message.guild.id, "reminders", false)) {
      await message.reply("Модуль Reminders выключен.");
      return true;
    }

    if (commandName === "afk") {
      const rawReason = args.join(" ").trim();
      const result = await this.setOrClearAfk(message.guild.id, message.author.id, rawReason || null);
      await message.reply(result.cleared
        ? "👋 AFK снят. С возвращением!"
        : "💤 AFK включён: " + result.record!.reason);
      return true;
    }

    if (commandName === "sticky") {
      if (!message.member?.permissions.has("ManageGuild")) {
        await message.reply("Для sticky message нужны права Manage Server.");
        return true;
      }
      const sub = (args.shift() ?? "setup").toLowerCase();
      if (sub === "list") {
        const rows = [...this.sticky.values()].filter((item) => item.guildId === message.guild!.id);
        await message.reply(rows.length
          ? "📌 **Sticky messages**\n" + rows.map((item) => "<#" + item.channelId + "> — " + item.content).join("\n").slice(0, 3900)
          : "Sticky messages не настроены.");
        return true;
      }
      const channelToken = args.shift() ?? "";
      const channelId = channelToken.replace(/[<#>]/g, "") || message.channelId;
      const channel = message.guild.channels.cache.get(channelId);
      if (!/^\d{17,20}$/.test(channelId) || channel?.type !== 0) {
        await message.reply("Укажи текстовый канал: !sticky setup #канал <текст>.");
        return true;
      }
      if (sub === "remove") {
        await this.removeSticky(message.guild.id, channelId);
        await message.reply("📌 Sticky message удалён.");
        return true;
      }
      const content = args.join(" ").trim();
      if (!content) {
        await message.reply("Использование: !sticky setup #канал <текст>.");
        return true;
      }
      await this.saveSticky(message.guild.id, channelId, content);
      await message.reply("📌 Sticky message настроен в <#" + channelId + ">.");
      return true;
    }

    if (commandName === "schedule") {
      if (!message.member?.permissions.has("ManageGuild")) {
        await message.reply("Для публикации по расписанию нужны права Manage Server.");
        return true;
      }
      const duration = parseReminderMinutes(args.shift() ?? "");
      const channelMention = args.shift() ?? "";
      const channelId = channelMention.replace(/[<#>]/g, "");
      const content = args.join(" ").trim();
      const channel = message.guild.channels.cache.get(channelId);
      if (!duration || !/^\d{17,20}$/.test(channelId) || channel?.type !== 0 || !content) {
        await message.reply("Использование: !schedule 30m #канал <текст>.");
        return true;
      }
      const dueAt = new Date(Date.now() + duration * 60_000);
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO reminders(guild_id,user_id,channel_id,target_channel_id,content,due_at)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [message.guild.id,message.author.id,message.channelId,channelId,content,dueAt]
      );
      await message.reply(`📅 Сообщение #${result.rows[0]?.id ?? "?"} будет отправлено в <#${channelId}> <t:${Math.floor(dueAt.getTime()/1000)}:R>.`);
      return true;
    }

    const duration = parseReminderMinutes(args.shift() ?? "");
    const content = args.join(" ").trim();
    if (!duration || !content) {
      await message.reply("Использование: !remind 30m <текст>.");
      return true;
    }

    const dueAt = new Date(Date.now() + duration * 60_000);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO reminders(guild_id,user_id,channel_id,content,due_at)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [message.guild.id,message.author.id,message.channelId,content,dueAt]
    );

    await message.reply(`⏰ Напоминание #${result.rows[0]?.id ?? "?"}: <t:${Math.floor(dueAt.getTime()/1000)}:R>`);
    return true;
  }

  async listUpcoming(guildId: string, userId: string, limit = 10): Promise<Array<{ id: number; content: string; dueAt: string }>> {
    const result = await this.db.query<{ id: string; content: string; due_at: string }>(
      "SELECT id,content,due_at FROM reminders WHERE guild_id=$1 AND user_id=$2 AND delivered_at IS NULL ORDER BY due_at ASC LIMIT $3",
      [guildId,userId,Math.min(Math.max(Math.floor(limit),1),25)]
    );
    return result.rows.map((row) => ({ id:Number(row.id),content:row.content,dueAt:row.due_at }));
  }

  async cancel(guildId: string, userId: string, id: number): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM reminders WHERE guild_id=$1 AND user_id=$2 AND id=$3 AND delivered_at IS NULL",
      [guildId,userId,id]
    );
    return result.rowCount === 1;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !["remind","schedule","sticky","afk"].includes(interaction.commandName)) return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "reminders", false)) {
      await interaction.reply({ content: "Модуль Reminders выключен.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "afk") {
      const rawReason = interaction.options.getString("reason");
      const result = await this.setOrClearAfk(interaction.guild!.id, interaction.user.id, rawReason);
      await interaction.reply({
        content: result.cleared
          ? "👋 AFK снят. С возвращением!"
          : "💤 AFK включён: " + result.record!.reason,
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "sticky") {
      if (!interaction.memberPermissions?.has("ManageGuild")) {
        await interaction.reply({ content: "Для sticky message нужны права Manage Server.", ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "list") {
        const rows = [...this.sticky.values()].filter((item) => item.guildId === interaction.guild!.id);
        await interaction.reply({
          content: rows.length
            ? "📌 **Sticky messages**\n" + rows.map((item) => "<#" + item.channelId + "> — " + item.content).join("\n").slice(0,3900)
            : "Sticky messages не настроены.",
          ephemeral: true
        });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== 0) {
        await interaction.reply({ content: "Нужен текстовый канал.", ephemeral: true });
        return;
      }
      if (sub === "remove") {
        await this.removeSticky(interaction.guild!.id, channel.id);
        await interaction.reply({ content: "📌 Sticky message удалён.", ephemeral: true });
        return;
      }
      const text = interaction.options.getString("text", true).trim();
      if (!text) {
        await interaction.reply({ content: "Текст sticky message не может быть пустым.", ephemeral: true });
        return;
      }
      await this.saveSticky(interaction.guild!.id, channel.id, text);
      await interaction.reply({ content: "📌 Sticky message настроен в <#" + channel.id + ">.", ephemeral: true });
      return;
    }

    const minutes = interaction.options.getInteger("minutes", true);
    const text = interaction.options.getString("text", true);

    if (interaction.commandName === "schedule") {
      if (!interaction.memberPermissions?.has("ManageGuild")) {
        await interaction.reply({ content: "Для публикации по расписанию нужны права Manage Server.", ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== 0) {
        await interaction.reply({ content: "Нужен текстовый канал.", ephemeral: true });
        return;
      }
      const dueAt = new Date(Date.now() + minutes * 60_000);
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO reminders(guild_id,user_id,channel_id,target_channel_id,content,due_at)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [interaction.guild!.id,interaction.user.id,interaction.channelId,channel.id,text,dueAt]
      );
      await interaction.reply({
        content: `📅 Сообщение #${result.rows[0]?.id ?? "?"} будет отправлено в <#${channel.id}> <t:${Math.floor(dueAt.getTime()/1000)}:R>.`,
        ephemeral: true
      });
      return;
    }

    const dueAt = new Date(Date.now() + minutes * 60_000);

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO reminders(guild_id,user_id,channel_id,content,due_at)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [interaction.guild!.id,interaction.user.id,interaction.channelId,text,dueAt]
    );

    await interaction.reply({
      content: `⏰ Напоминание #${result.rows[0]?.id ?? "?"}: <t:${Math.floor(dueAt.getTime()/1000)}:R>`,
      ephemeral: true
    });
  }


  private async handleMessageActivity(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "reminders", false)) return;

    try {
      const mentions = [...message.mentions.users.values()]
        .filter((user) => !user.bot && user.id !== message.author.id)
        .map((user) => user.id)
        .slice(0, 25);

      if (mentions.length) {
        const afkUsers = await this.listAfk(message.guild.id, mentions);
        if (afkUsers.length) {
          const notices = afkUsers.map((entry) =>
            formatAfkNotice("<@" + entry.userId + ">", entry.reason, entry.sinceAt)
          );
          await message.reply("💬 " + notices.join("\n").slice(0, 1900));
        }
      }

      const cleared = await this.clearAfk(message.guild.id, message.author.id);
      if (cleared) {
        const reply = await message.reply("👋 С возвращением! Твой AFK-статус снят.");
        setTimeout(() => {
          void reply.delete().catch(() => undefined);
        }, 8_000).unref();
      }
    } catch (error) {
      logger.warn("AFK message handling failed", {
        guildId: message.guild.id,
        userId: message.author.id,
        error: String(error)
      });
    }
  }

  private async setOrClearAfk(
    guildId: string,
    userId: string,
    rawReason: string | null
  ): Promise<{ cleared: boolean; record?: AfkRecord }> {
    if (isAfkClearRequest(rawReason) || (rawReason === null && await this.getAfk(guildId, userId))) {
      const cleared = await this.clearAfk(guildId, userId);
      return { cleared: Boolean(cleared) };
    }

    const reason = normalizeAfkReason(rawReason);
    const result = await this.db.query<{ user_id: string; reason: string; since_at: Date | string }>(
      `INSERT INTO afk_users(guild_id,user_id,reason,since_at,updated_at)
       VALUES($1,$2,$3,now(),now())
       ON CONFLICT(guild_id,user_id) DO UPDATE SET
         reason=EXCLUDED.reason,
         since_at=now(),
         updated_at=now()
       RETURNING user_id,reason,since_at`,
      [guildId, userId, reason]
    );
    const row = result.rows[0];
    if (!row) throw new Error("afk_write_failed");
    return {
      cleared: false,
      record: {
        userId: row.user_id,
        reason: row.reason,
        sinceAt: new Date(row.since_at)
      }
    };
  }

  private async getAfk(guildId: string, userId: string): Promise<AfkRecord | null> {
    const result = await this.db.query<{ user_id: string; reason: string; since_at: Date | string }>(
      "SELECT user_id,reason,since_at FROM afk_users WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    const row = result.rows[0];
    return row
      ? { userId: row.user_id, reason: row.reason, sinceAt: new Date(row.since_at) }
      : null;
  }

  private async listAfk(guildId: string, userIds: string[]): Promise<AfkRecord[]> {
    if (!userIds.length) return [];
    const result = await this.db.query<{ user_id: string; reason: string; since_at: Date | string }>(
      "SELECT user_id,reason,since_at FROM afk_users WHERE guild_id=$1 AND user_id=ANY($2::text[]) ORDER BY since_at ASC",
      [guildId, userIds]
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      reason: row.reason,
      sinceAt: new Date(row.since_at)
    }));
  }

  private async clearAfk(guildId: string, userId: string): Promise<AfkRecord | null> {
    const result = await this.db.query<{ user_id: string; reason: string; since_at: Date | string }>(
      "DELETE FROM afk_users WHERE guild_id=$1 AND user_id=$2 RETURNING user_id,reason,since_at",
      [guildId, userId]
    );
    const row = result.rows[0];
    return row
      ? { userId: row.user_id, reason: row.reason, sinceAt: new Date(row.since_at) }
      : null;
  }

  private async loadSticky(): Promise<void> {
    const result = await this.db.query<{ guild_id: string; channel_id: string; content: string; message_id: string | null }>(
      "SELECT guild_id,channel_id,content,message_id FROM sticky_messages"
    );
    this.sticky.clear();
    for (const row of result.rows) {
      this.sticky.set(row.guild_id + ":" + row.channel_id, {
        guildId: row.guild_id,
        channelId: row.channel_id,
        content: row.content,
        messageId: row.message_id
      });
    }
  }

  private async saveSticky(guildId: string, channelId: string, content: string): Promise<void> {
    const normalized = content.slice(0, 2000);
    await this.db.query(
      "INSERT INTO sticky_messages(guild_id,channel_id,content) VALUES($1,$2,$3) ON CONFLICT(guild_id,channel_id) DO UPDATE SET content=EXCLUDED.content,message_id=NULL,updated_at=now()",
      [guildId,channelId,normalized]
    );
    this.sticky.set(guildId + ":" + channelId, { guildId, channelId, content: normalized, messageId: null });
    await this.refreshSticky(guildId, channelId);
  }

  private async removeSticky(guildId: string, channelId: string): Promise<void> {
    const key = guildId + ":" + channelId;
    const item = this.sticky.get(key);
    const channel = this.client?.channels.cache.get(channelId);
    if (item?.messageId && channel?.isTextBased() && "messages" in channel) {
      await channel.messages.delete(item.messageId).catch(() => undefined);
    }
    await this.db.query("DELETE FROM sticky_messages WHERE guild_id=$1 AND channel_id=$2", [guildId,channelId]);
    this.sticky.delete(key);
  }

  private async refreshSticky(guildId: string, channelId: string): Promise<void> {
    const key = guildId + ":" + channelId;
    const item = this.sticky.get(key);
    if (!item || this.stickyBusy.has(key) || !this.client) return;
    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !("send" in channel) || !("messages" in channel)) return;

    this.stickyBusy.add(key);
    try {
      if (item.messageId) {
        await channel.messages.delete(item.messageId).catch(() => undefined);
      }
      const sent = await channel.send(item.content);
      item.messageId = sent.id;
      await this.db.query(
        "UPDATE sticky_messages SET message_id=$1,updated_at=now() WHERE guild_id=$2 AND channel_id=$3",
        [sent.id,guildId,channelId]
      );
    } catch (error) {
      logger.warn("Sticky message refresh failed", { guildId, channelId, error: String(error) });
    } finally {
      this.stickyBusy.delete(key);
    }
  }

  private async deliver(): Promise<void> {
    if (this.running || !this.client) return;
    this.running = true;

    try {
      const due = await this.db.query<{
        id: string;
        guild_id: string;
        user_id: string;
        target_channel_id: string | null;
        content: string;
      }>(
        `UPDATE reminders
         SET processing_until=now()+interval '2 minutes',
             delivery_attempts=delivery_attempts+1
         WHERE id IN (
           SELECT r.id
           FROM reminders r
           INNER JOIN guild_bot_assignments ga ON ga.guild_id = r.guild_id
           WHERE r.delivered_at IS NULL
             AND r.due_at <= now()
             AND (r.processing_until IS NULL OR r.processing_until < now())
             AND (
               ga.bot_identity_id = $1
               OR (
                 $1 = 'primary'
                 AND ga.bot_identity_id <> 'primary'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM bot_heartbeats bh
                   WHERE bh.bot_identity_id = ga.bot_identity_id
                     AND bh.last_seen_at >= now()-interval '90 seconds'
                 )
               )
             )
           ORDER BY r.due_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 50
         )
         RETURNING id,guild_id,user_id,target_channel_id,content`
      , [this.identityId]);

      for (const reminder of due.rows) {
        try {
          if (reminder.target_channel_id) {
            const channel = this.client.channels.cache.get(reminder.target_channel_id);
            if (!channel?.isTextBased() || !("send" in channel)) throw new Error("scheduled_channel_unavailable");
            await channel.send(reminder.content);
          } else {
            const user = await this.client.users.fetch(reminder.user_id);
            await user.send(`⏰ Напоминание: ${reminder.content}`);
          }

          await this.db.query(
            "UPDATE reminders SET delivered_at=now(),processing_until=NULL,last_error=NULL WHERE id=$1 AND delivered_at IS NULL",
            [reminder.id]
          );
        } catch (error) {
          await this.db.query(
            "UPDATE reminders SET processing_until=NULL,last_error=$1 WHERE id=$2",
            [String(error).slice(0, 1000),reminder.id]
          );
          logger.warn("Reminder delivery failed", {
            reminderId: reminder.id,
            guildId: reminder.guild_id,
            userId: reminder.user_id,
            error: String(error)
          });
        }
      }
    } catch (error) {
      logger.error("Reminder worker cycle failed", { identityId: this.identityId, error: String(error) });
    } finally {
      this.running = false;
    }
  }
}

export function normalizeAfkReason(value?: string | null): string {
  const trimmed = (value ?? "").trim().slice(0, 500);
  return trimmed || "Отошёл ненадолго.";
}

export function isAfkClearRequest(value?: string | null): boolean {
  return /^(off|clear|remove|unset)$/i.test((value ?? "").trim());
}

export function formatAfkNotice(mention: string, reason: string, sinceAt: Date | string): string {
  const timestamp = new Date(sinceAt).getTime();
  const unix = Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : Math.floor(Date.now() / 1000);
  return `${mention} AFK: ${reason} · с <t:${unix}:R>`;
}

function parseReminderMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const factor = match[2] === "w" ? 10080 : match[2] === "d" ? 1440 : match[2] === "h" ? 60 : 1;
  const total = n * factor;
  return Number.isSafeInteger(total) && total >= 1 && total <= 525600 ? total : null;
}
