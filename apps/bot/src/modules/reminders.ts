import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Reminders implements PlatformModule {
  readonly name = "reminders";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: Client;
  private running = false;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
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
           SELECT id FROM reminders
           WHERE delivered_at IS NULL
             AND due_at <= now()
             AND (processing_until IS NULL OR processing_until < now())
           ORDER BY due_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 50
         )
         RETURNING id,guild_id,user_id,content`
      );

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
        }
      }
    } finally {
      this.running = false;
    }
  }
}
