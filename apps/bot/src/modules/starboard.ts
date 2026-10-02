import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type MessageReaction,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type StarboardConfig = {
  channelId: string;
  threshold: number;
  ignoreSelfReaction: boolean;
  ignoreBots: boolean;
};

export function shouldRollbackStarboardPublication(messageId: string | null): boolean {
  return Boolean(messageId);
}

export class Starboard implements PlatformModule {
  readonly name = "starboard";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("reaction.add", ({ reaction, user }) =>
      this.onReaction(reaction, user)
    );
    const b = context.events.on("interaction.command", (interaction) =>
      this.onCommand(interaction)
    );

    this.unsubscribe = () => {
      a();
      b();
    };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "starboard") return;

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    if (interaction.options.getSubcommand() !== "setup") return;

    const channelOption = interaction.options.getChannel("channel", true);
    const channel = interaction.guild!.channels.cache.get(channelOption.id);
    if (!channel || channel.type !== 0) {
      await interaction.reply({ content: "Starboard channel должен быть текстовым.", ephemeral: true });
      return;
    }

    await this.configure(
      interaction.guild!.id,
      channel.id,
      interaction.options.getInteger("threshold") ?? 3
    );

    await interaction.reply({
      content: "Starboard настроен и включён.",
      ephemeral: true
    });
  }

  private async getConfig(guildId: string): Promise<StarboardConfig | null> {
    const result = await this.db.query<{
      channel_id: string;
      threshold: number;
      ignore_self_reaction: boolean;
      ignore_bots: boolean;
    }>(
      "SELECT channel_id,threshold,ignore_self_reaction,ignore_bots FROM starboard_settings WHERE guild_id=$1",
      [guildId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      channelId: row.channel_id,
      threshold: Math.min(Math.max(row.threshold, 1), 100),
      ignoreSelfReaction: row.ignore_self_reaction,
      ignoreBots: row.ignore_bots
    };
  }

  private async onReaction(reaction: MessageReaction, user: User): Promise<void> {
    let publishedMessageId: string | null = null;
    const guild = reaction.message.guild;
    if (!guild) return;
    const guildId = guild.id;

    const config = await this.getConfig(guildId);
    if (!config) return;
    if (!await moduleEnabled(this.db, guildId, "starboard", false)) return;
    if (reaction.emoji.name !== "⭐") return;
    if (config.ignoreBots && user.bot) return;
    if (config.ignoreSelfReaction && reaction.message.author?.id === user.id) return;

    if (reaction.message.partial) {
      await reaction.message.fetch().catch((error) => {
        logger.warn("Starboard partial message fetch failed", {
          guildId: reaction.message.guild?.id,
          sourceMessageId: reaction.message.id,
          error: String(error)
        });
      });
    }

    const count = reaction.count ?? 0;
    if (count < config.threshold) return;

    const channel = guild.channels.cache.get(config.channelId);
    if (!channel?.isTextBased() || !(("send" in channel))) return;

    const embed = new EmbedBuilder()
      .setAuthor({
        name: reaction.message.author?.tag ?? "Unknown user",
        iconURL: reaction.message.author?.displayAvatarURL({ size: 64 })
      })
      .setDescription(reaction.message.content?.slice(0, 4000) || "(no text)")
      .addFields({ name: "Stars", value: `⭐ ${count}`, inline: true })
      .setFooter({
        text: `Source channel: ${reaction.message.channelId} · ${reaction.message.id}`
      });

    await this.db.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [guildId + ":" + reaction.message.id]
      );

      const existing = await client.query<{ starboard_message_id: string | null }>(
        "SELECT starboard_message_id FROM starboard_entries WHERE guild_id=$1 AND source_message_id=$2",
        [guildId, reaction.message.id]
      );

      if (existing.rows[0]?.starboard_message_id) {
        const message = await channel.messages.fetch(existing.rows[0].starboard_message_id).catch((error) => {
          logger.warn("Starboard message fetch failed", {
            guildId: guildId,
            sourceMessageId: reaction.message.id,
            starboardMessageId: existing.rows[0]?.starboard_message_id,
            error: String(error)
          });
          return null;
        });

        if (message) {
          await message.edit({ embeds: [embed] }).catch((error) => {
            logger.warn("Starboard message update failed", {
              guildId: guildId,
              sourceMessageId: reaction.message.id,
              starboardMessageId: message.id,
              error: String(error)
            });
          });
          return;
        }
      }

      const sent = await channel.send({ embeds: [embed] }).catch((error) => {
        logger.error("Starboard publication failed", {
          guildId: guildId,
          sourceMessageId: reaction.message.id,
          channelId: config.channelId,
          error: String(error)
        });
        throw error;
      });
      publishedMessageId = sent.id;

      await client.query(
        `INSERT INTO starboard_entries(
           guild_id,source_message_id,starboard_message_id
         )
         VALUES($1,$2,$3)
         ON CONFLICT(guild_id,source_message_id)
         DO UPDATE SET starboard_message_id=EXCLUDED.starboard_message_id`,
        [guildId, reaction.message.id, sent.id]
      );
    }).catch(async (error) => {
      if (shouldRollbackStarboardPublication(publishedMessageId)) {
        await channel.messages.delete(publishedMessageId!).catch((deleteError) => {
          logger.warn("Starboard publication rollback message delete failed", {
            guildId: guildId,
            sourceMessageId: reaction.message.id,
            starboardMessageId: publishedMessageId,
            error: String(deleteError)
          });
        });
      }
      logger.error("Starboard transaction failed", {
        guildId: guildId,
        sourceMessageId: reaction.message.id,
        error: String(error)
      });
    });
  }

  async configure(
    guildId: string,
    channelId: string,
    threshold: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO starboard_settings(
         guild_id,channel_id,threshold,ignore_self_reaction,ignore_bots
       )
       VALUES($1,$2,$3,true,true)
       ON CONFLICT(guild_id) DO UPDATE SET
         channel_id=EXCLUDED.channel_id,
         threshold=EXCLUDED.threshold,
         updated_at=now()`,
      [guildId, channelId, Math.min(Math.max(threshold, 1), 100)]
    );

    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'starboard',true)
       ON CONFLICT(guild_id,module_key)
       DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );
  }
}
