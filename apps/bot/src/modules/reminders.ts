import type { ChatInputCommandInteraction, Client, Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export class Reminders implements PlatformModule {
  readonly name = "reminders";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: Client;
  private running = false;
  private identityId = "primary";

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.identityId = context.identityId;
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
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
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot || (commandName !== "remind" && commandName !== "schedule")) return false;
    if (!await moduleEnabled(this.db, message.guild.id, "reminders", false)) {
      await message.reply("Модуль Reminders выключен.");
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
    if (!interaction.inGuild() || (interaction.commandName !== "remind" && interaction.commandName !== "schedule")) return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "reminders", false)) {
      await interaction.reply({ content: "Модуль Reminders выключен.", ephemeral: true });
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

function parseReminderMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const factor = match[2] === "w" ? 10080 : match[2] === "d" ? 1440 : match[2] === "h" ? 60 : 1;
  const total = n * factor;
  return Number.isSafeInteger(total) && total >= 1 && total <= 525600 ? total : null;
}
