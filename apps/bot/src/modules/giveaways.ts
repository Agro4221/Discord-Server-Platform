import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import { randomInt } from "node:crypto";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Giveaways implements PlatformModule {
  readonly name = "giveaways";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.timer = setInterval(() => void this.sweep(), 5_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "giveaway") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "giveaways", false)) {
      await interaction.reply({ content: "Модуль Giveaways выключен.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const minutes = interaction.options.getInteger("minutes", true);
    const winners = interaction.options.getInteger("winners") ?? 1;
    const prize = interaction.options.getString("prize", true);
    const endsAt = new Date(Date.now() + minutes * 60_000);

    const created = await this.db.query<{ id: string }>(
      `INSERT INTO giveaways(guild_id,channel_id,host_user_id,prize,winners,ends_at,status)
       VALUES($1,$2,$3,$4,$5,$6,'running') RETURNING id`,
      [interaction.guild.id, interaction.channelId, interaction.user.id, prize, winners, endsAt]
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error("giveaway id missing");

    const message = await interaction.channel!.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎉 Giveaway")
          .setDescription(`**Приз:** ${prize}\n**Победителей:** ${winners}\n**До:** <t:${Math.floor(endsAt.getTime()/1000)}:R>`)
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`dsp:giveaway:enter:${id}`)
            .setLabel("Участвовать")
            .setStyle(ButtonStyle.Success)
        )
      ]
    });

    await this.db.query("UPDATE giveaways SET message_id=$1 WHERE id=$2", [message.id, id]);
    await interaction.reply({ content: "Giveaway создан.", ephemeral: true });
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:giveaway:") || !interaction.guild) return;
    const [, , action, rawId] = interaction.customId.split(":");
    const id = Number(rawId);
    if (action !== "enter" || !Number.isSafeInteger(id)) return;

    const result = await this.db.query<{ status: string }>(
      "SELECT status FROM giveaways WHERE id=$1 AND guild_id=$2",
      [id, interaction.guild.id]
    );
    if (result.rows[0]?.status !== "running") {
      await interaction.reply({ content: "Этот giveaway уже завершён.", ephemeral: true });
      return;
    }

    await this.db.query(
      "INSERT INTO giveaway_entries(giveaway_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, interaction.user.id]
    );
    await interaction.reply({ content: "Ты участвуешь! 🎉", ephemeral: true });
  }

  private async sweep(): Promise<void> {
    const expired = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      message_id: string;
      prize: string;
      winners: number;
    }>(
      `SELECT id,guild_id,channel_id,message_id,prize,winners
       FROM giveaways
       WHERE status='running' AND ends_at <= now()
       LIMIT 20`
    );

    for (const giveaway of expired.rows) {
      const entries = await this.db.query<{ user_id: string }>(
        "SELECT user_id FROM giveaway_entries WHERE giveaway_id=$1",
        [giveaway.id]
      );

      const pool = [...entries.rows.map((row) => row.user_id)];
      const selected: string[] = [];
      while (pool.length > 0 && selected.length < giveaway.winners) {
        selected.push(pool.splice(randomInt(pool.length), 1)[0]!);
      }

      await this.db.transaction(async (client) => {
        await client.query(
          "UPDATE giveaways SET status='finished',selected_winners=$1::jsonb,finished_at=now() WHERE id=$2 AND status='running'",
          [JSON.stringify(selected), giveaway.id]
        );
      });

      loggerSafe(`Giveaway #${giveaway.id} finished`);
    }
  }
}

function loggerSafe(message: string): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "INFO", message }));
}
