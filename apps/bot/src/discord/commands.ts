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
import { Moderation } from "../modules/moderation.js";

export function buildCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check platform health"),

    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure the server")
      .addSubcommand((sub) =>
        sub
          .setName("temp-voice")
          .setDescription("Configure temporary voice rooms")
          .addChannelOption((option) =>
            option
              .setName("trigger")
              .setDescription("Voice channel that creates a room when joined")
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
              .setDescription("Default user limit (0 = unlimited)")
              .setMinValue(0)
              .setMaxValue(99)
          )
          .addBooleanOption((option) =>
            option
              .setName("private")
              .setDescription("Make rooms private to their owner")
          )
      ),

    new SlashCommandBuilder()
      .setName("moderate")
      .setDescription("Moderation actions")
      .addSubcommand((sub) =>
        sub
          .setName("warn")
          .setDescription("Warn a user")
          .addUserOption((option) =>
            option.setName("user").setDescription("User").setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("reason")
              .setDescription("Reason")
              .setMaxLength(1000)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("timeout")
          .setDescription("Timeout a member")
          .addUserOption((option) =>
            option.setName("user").setDescription("Member").setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("minutes")
              .setDescription("Duration in minutes")
              .setMinValue(1)
              .setMaxValue(40320)
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("reason")
              .setDescription("Reason")
              .setMaxLength(1000)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("kick")
          .setDescription("Kick a member")
          .addUserOption((option) =>
            option.setName("user").setDescription("Member").setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("reason")
              .setDescription("Reason")
              .setMaxLength(1000)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("ban")
          .setDescription("Ban a member")
          .addUserOption((option) =>
            option.setName("user").setDescription("Member").setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("reason")
              .setDescription("Reason")
              .setMaxLength(1000)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("history")
          .setDescription("Show recent moderation cases")
          .addUserOption((option) =>
            option.setName("user").setDescription("User").setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("limit")
              .setDescription("Number of cases")
              .setMinValue(1)
              .setMaxValue(50)
          )
      ),

    new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Ticket system")
      .addSubcommand((sub) =>
        sub.setName("create").setDescription("Create a support ticket")
      )
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure tickets")
          .addChannelOption((option) =>
            option
              .setName("category")
              .setDescription("Ticket category")
              .addChannelTypes(ChannelType.GuildCategory)
          )
          .addRoleOption((option) =>
            option.setName("staff-role").setDescription("Staff role")
          )
          .addChannelOption((option) =>
            option
              .setName("transcript-channel")
              .setDescription("Transcript channel")
              .addChannelTypes(ChannelType.GuildText)
          )
      ),

    new SlashCommandBuilder()
      .setName("roles")
      .setDescription("Role panels")
      .addSubcommand((sub) =>
        sub
          .setName("panel")
          .setDescription("Create a role panel")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addRoleOption((option) =>
            option.setName("role").setDescription("Role to toggle").setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("label")
              .setDescription("Button label")
              .setMaxLength(80)
              .setRequired(true)
          )
      ),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Giveaways")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a giveaway")
          .addIntegerOption((option) =>
            option
              .setName("minutes")
              .setDescription("Duration")
              .setMinValue(1)
              .setMaxValue(10080)
              .setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("winners")
              .setDescription("Winner count")
              .setMinValue(1)
              .setMaxValue(100)
          )
          .addStringOption((option) =>
            option
              .setName("prize")
              .setDescription("Prize")
              .setMaxLength(200)
              .setRequired(true)
          )
      ),

    new SlashCommandBuilder()
      .setName("economy")
      .setDescription("Economy")
      .addSubcommand((sub) =>
        sub
          .setName("balance")
          .setDescription("Show balance")
          .addUserOption((option) => option.setName("user").setDescription("User"))
      )
      .addSubcommand((sub) =>
        sub.setName("daily").setDescription("Claim daily coins")
      )
      .addSubcommand((sub) =>
        sub.setName("leaderboard").setDescription("Show richest users")
      )
      .addSubcommand((sub) =>
        sub
          .setName("pay")
          .setDescription("Transfer coins")
          .addUserOption((option) =>
            option.setName("user").setDescription("Recipient").setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("amount")
              .setDescription("Amount")
              .setMinValue(1)
              .setMaxValue(1_000_000)
              .setRequired(true)
          )
      ),

    new SlashCommandBuilder()
      .setName("shop")
      .setDescription("Economy shop")
      .addSubcommand((sub) => sub.setName("list").setDescription("List available items"))
      .addSubcommand((sub) =>
        sub
          .setName("buy")
          .setDescription("Buy an item")
          .addIntegerOption((o) => o.setName("item").setDescription("Item id").setMinValue(1).setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create shop item")
          .addStringOption((o) => o.setName("name").setDescription("Name").setMaxLength(80).setRequired(true))
          .addStringOption((o) => o.setName("description").setDescription("Description").setMaxLength(500).setRequired(true))
          .addIntegerOption((o) => o.setName("price").setDescription("Price").setMinValue(1).setMaxValue(1000000000).setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("Optional role reward"))
          .addIntegerOption((o) => o.setName("stock").setDescription("Optional stock").setMinValue(1).setMaxValue(100000))
      ),

    new SlashCommandBuilder()
      .setName("remind")
      .setDescription("Create a reminder")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("Delay in minutes")
          .setMinValue(1)
          .setMaxValue(525600)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Reminder text")
          .setMaxLength(1000)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("starboard")
      .setDescription("Starboard")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure starboard")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Starboard channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("threshold")
              .setDescription("Stars required")
              .setMinValue(1)
              .setMaxValue(100)
          )
      ),

    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Member verification")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure verification")
          .addChannelOption((o) => o.setName("channel").setDescription("Optional verification channel").addChannelTypes(ChannelType.GuildText))
          .addRoleOption((o) => o.setName("verified-role").setDescription("Role granted after verification"))
          .addChannelOption((o) => o.setName("log-channel").setDescription("Optional log channel").addChannelTypes(ChannelType.GuildText))
          .addIntegerOption((o) => o.setName("ttl").setDescription("Code lifetime in minutes").setMinValue(2).setMaxValue(60))
      )
      .addSubcommand((sub) =>
        sub
          .setName("panel")
          .setDescription("Publish verification panel")
          .addChannelOption((o) => o.setName("channel").setDescription("Panel channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      ),
    new SlashCommandBuilder()
      .setName("analytics")
      .setDescription("Server analytics"),
    new SlashCommandBuilder()
      .setName("security")
      .setDescription("Security / anti-raid")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure anti-raid")
          .addIntegerOption((o) => o.setName("max-joins").setDescription("Joins in the window").setMinValue(2).setMaxValue(200).setRequired(true))
          .addIntegerOption((o) => o.setName("window").setDescription("Window in seconds").setMinValue(5).setMaxValue(300).setRequired(true))
          .addRoleOption((o) => o.setName("quarantine-role").setDescription("Optional quarantine role"))
          .addChannelOption((o) => o.setName("log-channel").setDescription("Security log channel").addChannelTypes(ChannelType.GuildText))
      ),
    new SlashCommandBuilder()
      .setName("feed")
      .setDescription("External notification feeds")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add an RSS/Atom feed")
          .addStringOption((o) => o.setName("url").setDescription("HTTPS feed URL").setMaxLength(2000).setRequired(true))
          .addChannelOption((o) => o.setName("channel").setDescription("Destination channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addIntegerOption((o) => o.setName("minutes").setDescription("Polling interval").setMinValue(1).setMaxValue(1440))
      ),
    new SlashCommandBuilder()
      .setName("music")
      .setDescription("Music player")
      .addSubcommand((sub) =>
        sub
          .setName("play")
          .setDescription("Play a song or search YouTube")
          .addStringOption((o) => o.setName("query").setDescription("Song, artist, URL or playlist").setMaxLength(2000).setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("pause").setDescription("Pause playback"))
      .addSubcommand((sub) => sub.setName("resume").setDescription("Resume playback"))
      .addSubcommand((sub) => sub.setName("skip").setDescription("Skip current track"))
      .addSubcommand((sub) => sub.setName("stop").setDescription("Stop and clear queue"))
      .addSubcommand((sub) => sub.setName("queue").setDescription("Show queue"))
      .addSubcommand((sub) => sub.setName("nowplaying").setDescription("Show current track"))
      .addSubcommand((sub) =>
        sub
          .setName("volume")
          .setDescription("Show/change volume")
          .addIntegerOption((o) => o.setName("value").setDescription("0-200").setMinValue(0).setMaxValue(200))
      ),
    new SlashCommandBuilder()
      .setName("automation")
      .setDescription("Automation rules")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a simple automation rule")
          .addStringOption((option) =>
            option.setName("name").setDescription("Rule name").setMaxLength(80).setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("event")
              .setDescription("Trigger event")
              .addChoices(
                { name: "Member joins", value: "member.join" },
                { name: "Member leaves", value: "member.leave" },
                { name: "Message created", value: "message.create" },
                { name: "Voice joins", value: "voice.join" },
                { name: "Voice leaves", value: "voice.leave" },
                { name: "Voice moves", value: "voice.move" }
              )
              .setRequired(true)
          )
          .addChannelOption((option) =>
            option.setName("channel").setDescription("Optional event channel filter")
          )
          .addStringOption((option) =>
            option.setName("match").setDescription("Optional message text filter").setMaxLength(200)
          )
          .addChannelOption((option) =>
            option
              .setName("response-channel")
              .setDescription("Channel to send the response to")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName("response")
              .setDescription("Response text")
              .setMaxLength(2000)
              .setRequired(true)
          )
      )
  ];
}

export async function handleCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  db: Database,
  temporaryVoice: TemporaryVoice,
  moderation: Moderation
): Promise<void> {
  if (interaction.commandName === "ping") {
    const start = performance.now();
    let database = "ok";
    try {
      await db.ping();
    } catch {
      database = "down";
    }
    await interaction.reply({
      content: `Pong! Gateway ${Math.max(0, client.ws.ping)}ms · Database ${database} · ${Math.round(performance.now() - start)}ms`,
      ephemeral: true
    });
    return;
  }

  if (!interaction.inGuild()) return;

  if (interaction.commandName === "setup") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Недостаточно прав: Manage Server.", ephemeral: true });
      return;
    }

    if (interaction.options.getSubcommand() === "temp-voice") {
      const trigger = interaction.options.getChannel("trigger", true);
      const category = interaction.options.getChannel("category");
      const limit = interaction.options.getInteger("limit") ?? 0;
      const privateByDefault = interaction.options.getBoolean("private") ?? false;

      if (trigger.type !== ChannelType.GuildVoice || (category && category.type !== ChannelType.GuildCategory)) {
        await interaction.reply({ content: "Выбраны некорректные типы каналов.", ephemeral: true });
        return;
      }

      const checker = new PermissionChecker(interaction.guild);
      const missing = checker.botMissing(PermissionChecker.requiredForTemporaryVoice());
      if (missing.length > 0) {
        await interaction.reply({
          content: `Нельзя включить Temporary Voice. Не хватает прав у бота: ${missing.join(", ")}`,
          ephemeral: true
        });
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
        content: `Готово. Вход в <#${trigger.id}> теперь создаёт временную комнату.`,
        ephemeral: true
      });

      logger.info("Temporary voice configured", {
        guildId: interaction.guild.id,
        triggerChannelId: trigger.id,
        categoryId: category?.id ?? null,
        privateByDefault
      });
    }
    return;
  }

  if (interaction.commandName !== "moderate") return;

  const subcommand = interaction.options.getSubcommand();
  const target = interaction.options.getUser("user", true);

  if (subcommand === "history") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Недостаточно прав.", ephemeral: true });
      return;
    }

    const limit = interaction.options.getInteger("limit") ?? 10;
    const cases = await moderation.history(interaction.guild.id, target.id, limit);
    const content = cases.length === 0
      ? "История модерации пуста."
      : cases
          .map((item) =>
            `#${item.id} · ${item.action} · ${item.reason ?? "без причины"} · <t:${Math.floor(item.createdAt.getTime() / 1000)}:R>`
          )
          .join("\n");

    await interaction.reply({ content, ephemeral: true });
    return;
  }

  const reason = interaction.options.getString("reason", true);

  if (subcommand === "warn") {
    await moderation.warn(interaction, target, reason);
    return;
  }

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      content: "Пользователь не найден среди участников сервера.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "timeout") {
    await moderation.timeout(
      interaction,
      member,
      interaction.options.getInteger("minutes", true),
      reason
    );
  } else if (subcommand === "kick") {
    await moderation.kick(interaction, member, reason);
  } else if (subcommand === "ban") {
    await moderation.ban(interaction, member, reason);
  }
}
