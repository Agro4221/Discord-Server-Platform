import type { ChatInputCommandInteraction, Client } from "discord.js";
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

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "remind") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "reminders", false)) {
      await interaction.reply({ content: "Модуль Reminders выключен.", ephemeral: true });
      return;
    }

    const minutes = interaction.options.getInteger("minutes", true);
    const text = interaction.options.getString("text", true);
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
        content: string;
      }>(
        `UPDATE reminders
         SET processing_until=now()+interval '2 minutes',
             delivery_attempts=delivery_attempts+1
         WHERE id IN (
           SELECT r.id
           FROM reminders r
           INNER JOIN guild_bot_assignments ga ON ga.guild_id = r.guild_id
           LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id = ga.bot_identity_id
           WHERE r.delivered_at IS NULL
             AND r.due_at <= now()
             AND (r.processing_until IS NULL OR r.processing_until < now())
             AND (
               ga.bot_identity_id = $1
               OR ($1 = 'primary' AND ga.bot_identity_id <> 'primary' AND bh.last_seen_at < now()-interval '90 seconds')
             )
           ORDER BY r.due_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 50
         )
         RETURNING id,guild_id,user_id,content`
      , [this.identityId]);

      for (const reminder of due.rows) {
        try {
          const user = await this.client.users.fetch(reminder.user_id);
          await user.send(`⏰ Напоминание: ${reminder.content}`);

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
