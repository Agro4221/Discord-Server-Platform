import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client
} from "discord.js";
import type { Database } from "../database.js";
import { logger } from "../logger.js";
import { PermissionChecker } from "./permissions.js";
import { TemporaryVoice } from "../modules/temporary-voice.js";

export function buildCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check the bot health"),
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName("temp-voice")
          .setDescription("Configure temporary voice rooms")
          .addChannelOption((option) =>
            option
              .setName("trigger")
              .setDescription("Voice channel that creates a room when a member joins")
              .addChannelTypes(ChannelType.GuildVoice)
              .setRequired(true)
          )
          .addChannelOption((option) =>
            option
              .setName("category")
              .setDescription("Optional category for created rooms")
              .addChannelTypes(ChannelType.GuildCategory)
          )
          .addIntegerOption((option) =>
            option
              .setName("limit")
              .setDescription("Default user limit, 0 means unlimited")
              .setMinValue(0)
              .setMaxValue(99)
          )
          .addBooleanOption((option) =>
            option
              .setName("private")
              .setDescription("Create rooms private to the owner by default")
          )
      )
  ];
}

export async function handleCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  db: Database,
  temporaryVoice: TemporaryVoice
): Promise<void> {
  if (interaction.commandName === "ping") {
    const dbStart = performance.now();
    let dbStatus = "ok";
    try {
      await db.ping();
    } catch {
      dbStatus = "down";
    }
    const dbMs = Math.round(performance.now() - dbStart);
    await interaction.reply({
      content: `Pong! Gateway: ${Math.round(client.ws.ping)}ms · DB: ${dbStatus} (${dbMs}ms)`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName !== "setup" || !interaction.inGuild()) return;

  const checker = new PermissionChecker(interaction.guild);
  const canManage = checker.memberHas(interaction.member, PermissionFlagsBits.ManageGuild);
  if (!canManage) {
    await interaction.reply({ content: "У тебя нет права Manage Server.", ephemeral: true });
    return;
  }

  if (interaction.options.getSubcommand() === "temp-voice") {
    const trigger = interaction.options.getChannel("trigger", true);
    const category = interaction.options.getChannel("category");
    const limit = interaction.options.getInteger("limit") ?? 0;
    const privateByDefault = interaction.options.getBoolean("private") ?? false;

    if (trigger.type !== ChannelType.GuildVoice) {
      await interaction.reply({ content: "Trigger должен быть голосовым каналом.", ephemeral: true });
      return;
    }

    if (category && category.type !== ChannelType.GuildCategory) {
      await interaction.reply({ content: "Category должна быть категорией.", ephemeral: true });
      return;
    }

    await temporaryVoice.configure(interaction.guild.id, {
      enabled: true,
      triggerChannelId: trigger.id,
      categoryId: category?.id ?? null,
      defaultLimit: limit,
      privateByDefault
    });

    await interaction.reply({
      content: `Готово. Теперь вход в <#${trigger.id}> будет создавать временную комнату.`,
      ephemeral: true
    });
    logger.info("Temporary voice configured", {
      guildId: interaction.guild.id,
      triggerChannelId: trigger.id
    });
  }
}
