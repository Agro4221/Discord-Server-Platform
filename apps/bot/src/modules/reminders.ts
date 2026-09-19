import type { ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Reminders implements PlatformModule {
  readonly name = "reminders";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.timer = setInterval(() => void this.deliver(), 5_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "remind") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "reminders", false)) {
      await interaction.reply({ content: "Модуль Reminders выключен.", ephemeral: true });
      return;
    }

    const minutes = interaction.options.getInteger("minutes", true);
    const text = interaction.options.getString("text", true);
    const dueAt = new Date(Date.now() + minutes * 60_000);

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO reminders(guild_id,user_id,channel_id,content,due_at)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [interaction.guild.id, interaction.user.id, interaction.channelId, text, dueAt]
    );

    await interaction.reply({
      content: `⏰ Напоминание #${result.rows[0]?.id ?? "?"}: <t:${Math.floor(dueAt.getTime()/1000)}:R>`,
      ephemeral: true
    });
  }

  private async deliver(): Promise<void> {
    const due = await this.db.query<{
      id: string;
      guild_id: string;
      user_id: string;
      content: string;
    }>(
      `SELECT id,guild_id,user_id,content
       FROM reminders
       WHERE delivered_at IS NULL AND due_at <= now()
       ORDER BY due_at ASC
       LIMIT 50`
    );

    for (const reminder of due.rows) {
      const marked = await this.db.query<{ id: string }>(
        "UPDATE reminders SET delivered_at=now() WHERE id=$1 AND delivered_at IS NULL RETURNING id",
        [reminder.id]
      );
      if (marked.rows.length === 0) continue;

      const guild = globalThis.__DSP_CLIENT?.guilds.cache.get(reminder.guild_id);
      const user = await globalThis.__DSP_CLIENT?.users.fetch(reminder.user_id).catch(() => null);
      await user?.send(`⏰ Напоминание: ${reminder.content}`).catch(() => undefined);
      void guild;
    }
  }
}
