import {
  EmbedBuilder,
  type MessageReaction,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Starboard implements PlatformModule {
  readonly name = "starboard";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("reaction.add", ({ reaction, user }) => this.onReaction(reaction, user));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: import("discord.js").ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "starboard") return;
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "setup") return;

    const channel = interaction.options.getChannel("channel", true);
    if (!channel.isTextBased()) {
      await interaction.reply({ content: "Starboard channel должен быть текстовым.", ephemeral: true });
      return;
    }

    await this.configure(
      interaction.guild.id,
      channel.id,
      interaction.options.getInteger("threshold") ?? 3
    );
    await interaction.reply({ content: "Starboard настроен и включён.", ephemeral: true });
  }

  private async onReaction(reaction: MessageReaction, user: User): Promise<void>
    if (!reaction.message.guild || user.bot) return;
    if (reaction.emoji.name !== "⭐") return;
    if (!await moduleEnabled(this.db, reaction.message.guild.id, "starboard", false)) return;

    const config = await this.db.query<{ channel_id: string; threshold: number }>(
      "SELECT channel_id,threshold FROM starboard_settings WHERE guild_id=$1",
      [reaction.message.guild.id]
    );
    const row = config.rows[0];
    if (!row) return;

    const count = reaction.count ?? 0;
    if (count < row.threshold) return;

    const existing = await this.db.query<{ starboard_message_id: string | null }>(
      "SELECT starboard_message_id FROM starboard_entries WHERE guild_id=$1 AND source_message_id=$2",
      [reaction.message.guild.id, reaction.message.id]
    );

    const channel = reaction.message.guild.channels.cache.get(row.channel_id);
    if (!channel?.isTextBased() || !("send" in channel)) return;

    const embed = new EmbedBuilder()
      .setAuthor({ name: reaction.message.author?.tag ?? "Unknown user" })
      .setDescription(reaction.message.content?.slice(0, 4000) || "(no text)")
      .addFields({ name: "Stars", value: `⭐ ${count}`, inline: true })
      .setFooter({ text: `Source: #${reaction.message.channelId} · ${reaction.message.id}` });

    if (existing.rows[0]?.starboard_message_id) {
      const message = await channel.messages.fetch(existing.rows[0].starboard_message_id).catch(() => null);
      await message?.edit({ embeds: [embed] }).catch(() => undefined);
      return;
    }

    const sent = await channel.send({ embeds: [embed] });
    await this.db.query(
      `INSERT INTO starboard_entries(guild_id,source_message_id,starboard_message_id)
       VALUES($1,$2,$3) ON CONFLICT(guild_id,source_message_id)
       DO UPDATE SET starboard_message_id=EXCLUDED.starboard_message_id`,
      [reaction.message.guild.id, reaction.message.id, sent.id]
    );

  }

  async configure(guildId: string, channelId: string, threshold: number): Promise<void> {
    await this.db.query(
      `INSERT INTO starboard_settings(guild_id,channel_id,threshold)
       VALUES($1,$2,$3)
       ON CONFLICT(guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,threshold=EXCLUDED.threshold,updated_at=now()`,
      [guildId, channelId, Math.min(Math.max(threshold, 1), 100)]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'starboard',true)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );
  }
}
