import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import type { Database } from "../database.js";
import { logger } from "../logger.js";
import { PermissionChecker } from "./permissions.js";
import { TemporaryVoice } from "../modules/temporary-voice.js";
import { Moderation } from "../modules/moderation.js";

export function buildCommands(): Array<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder> {
  return [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show available Vexa commands"),

    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check platform health"),

    new SlashCommandBuilder()
      .setName("level")
      .setDescription("Show your leveling rank")
      .addUserOption((o) => o.setName("user").setDescription("Optional user")),
    new SlashCommandBuilder()
      .setName("rank")
      .setDescription("Show a user's leveling rank")
      .addUserOption((o) => o.setName("user").setDescription("Optional user")),
    new SlashCommandBuilder()
      .setName("top")
      .setDescription("Show the leveling leaderboard"),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("Optional duration, e.g. 10m, 2h, 7d")),
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 10m, 2h, 1d").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a user")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true)),
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Unban a user")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(1000).setRequired(true)),

    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a track or playlist")
      .addStringOption((o) => o.setName("query").setDescription("Song, URL or playlist").setMaxLength(2000).setRequired(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Pause music"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume music"),
    new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop music and clear the queue"),
    new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),
    new SlashCommandBuilder().setName("playlist").setDescription("Show the current playlist/queue"),
    new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
    new SlashCommandBuilder()
      .setName("repeat")
      .setDescription("Set repeat mode")
      .addStringOption((o) => o.setName("mode").setDescription("off, track or queue").addChoices(
        { name: "Off", value: "off" },
        { name: "Track", value: "track" },
        { name: "Queue", value: "queue" }
      ).setRequired(true)),
    new SlashCommandBuilder()
      .setName("seek")
      .setDescription("Seek within the current track")
      .addIntegerOption((o) => o.setName("seconds").setDescription("Position in seconds").setMinValue(0).setMaxValue(86400).setRequired(true)),
    new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Show or change volume")
      .addIntegerOption((o) => o.setName("value").setDescription("0-200").setMinValue(0).setMaxValue(200)),
    new SlashCommandBuilder()
      .setName("autoplay")
      .setDescription("Show or change autoplay")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Autoplay state")),
    new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Delete recent messages")
      .addIntegerOption((o) => o.setName("amount").setDescription("1-100").setMinValue(1).setMaxValue(100).setRequired(true)),
    new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Set channel slowmode")
      .addIntegerOption((o) => o.setName("seconds").setDescription("0-21600").setMinValue(0).setMaxValue(21600).setRequired(true)),
    new SlashCommandBuilder().setName("lock").setDescription("Lock the current channel"),
    new SlashCommandBuilder().setName("unlock").setDescription("Unlock the current channel"),

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
          .setName("unban")
          .setDescription("Unban a user")
          .addUserOption((option) =>
            option.setName("user").setDescription("Banned user").setRequired(true)
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
      )
      .addSubcommand((sub) =>
        sub
          .setName("note")
          .setDescription("Manage private moderation notes")
          .addStringOption((option) =>
            option.setName("action").setDescription("Add or list notes").addChoices(
              { name: "Add", value: "add" },
              { name: "List", value: "list" }
            ).setRequired(true)
          )
          .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
          .addStringOption((option) => option.setName("text").setDescription("Note text").setMaxLength(1000))
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
          .addIntegerOption((option) =>
            option.setName("max-open").setDescription("Max open tickets per user").setMinValue(1).setMaxValue(10)
          )
          .addIntegerOption((option) =>
            option.setName("auto-close").setDescription("Auto-close after inactivity in minutes; 0 = off").setMinValue(0).setMaxValue(43200)
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
          .addStringOption((option) =>
            option
              .setName("mode")
              .setDescription("Role selection mode")
              .addChoices(
                { name: "Toggle", value: "toggle" },
                { name: "Exclusive", value: "exclusive" },
                { name: "Max selections", value: "max" }
              )
          )
          .addIntegerOption((option) =>
            option.setName("max-selections").setDescription("Maximum selections for max mode").setMinValue(1).setMaxValue(5)
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
          .addStringOption((option) =>
            option
              .setName("prize")
              .setDescription("Prize")
              .setMaxLength(200)
              .setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("winners")
              .setDescription("Winner count")
              .setMinValue(1)
              .setMaxValue(100)
          )
      )
      .addSubcommand((sub) => sub
        .setName("end")
        .setDescription("End a running giveaway")
        .addIntegerOption((o) => o.setName("id").setDescription("Giveaway id").setMinValue(1).setRequired(true))
      )
      .addSubcommand((sub) => sub
        .setName("reroll")
        .setDescription("Reroll a finished giveaway")
        .addIntegerOption((o) => o.setName("id").setDescription("Giveaway id").setMinValue(1).setRequired(true))
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
          .addRoleOption((o) => o.setName("quarantine-role").setDescription("Role applied until verification"))
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
      .setName("poll")
      .setDescription("Interactive polls")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Create a poll")
          .addStringOption((o) => o.setName("question").setDescription("Question").setMaxLength(300).setRequired(true))
          .addStringOption((o) => o.setName("options").setDescription("Options separated by |").setMaxLength(500).setRequired(true))
          .addBooleanOption((o) => o.setName("multiple").setDescription("Allow multiple selections"))
          .addIntegerOption((o) => o.setName("minutes").setDescription("Close automatically after N minutes; 0 = no limit").setMinValue(0).setMaxValue(43200))
      )
      .addSubcommand((sub) =>
        sub
          .setName("close")
          .setDescription("Close a poll")
          .addIntegerOption((o) => o.setName("id").setDescription("Poll id").setMinValue(1).setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName("analytics")
      .setDescription("Server analytics"),
    new SlashCommandBuilder()
      .setName("automod")
      .setDescription("AutoMod")
      .addSubcommand((sub) => sub.setName("setup").setDescription("Configure AutoMod")
        .addStringOption((o) => o.setName("blocked-words").setDescription("Comma/newline separated blocked words").setMaxLength(5000))
        .addIntegerOption((o) => o.setName("max-mentions").setDescription("Max mentions").setMinValue(1).setMaxValue(50))
        .addNumberOption((o) => o.setName("caps-ratio").setDescription("Caps ratio 0-1").setMinValue(0).setMaxValue(1))
        .addIntegerOption((o) => o.setName("repeats").setDescription("Repeated messages threshold").setMinValue(2).setMaxValue(20))
        .addIntegerOption((o) => o.setName("window").setDescription("Repeat window seconds").setMinValue(2).setMaxValue(120))
        .addBooleanOption((o) => o.setName("delete").setDescription("Delete violating messages"))
        .addIntegerOption((o) => o.setName("timeout").setDescription("Timeout minutes").setMinValue(0).setMaxValue(40320))
      ),

    new SlashCommandBuilder()
      .setName("welcome")
      .setDescription("Welcome messages")
      .addSubcommand((sub) => sub.setName("setup").setDescription("Configure Welcome")
        .addChannelOption((o) => o.setName("channel").setDescription("Welcome channel").addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName("message").setDescription("Welcome message").setMaxLength(2000))
        .addBooleanOption((o) => o.setName("dm").setDescription("Send DM"))
        .addBooleanOption((o) => o.setName("embed").setDescription("Use embed"))
      ),

    new SlashCommandBuilder()
      .setName("leveling")
      .setDescription("Leveling")
      .addSubcommand((sub) => sub.setName("setup").setDescription("Configure Leveling")
        .addIntegerOption((o) => o.setName("xp").setDescription("XP per message").setMinValue(1).setMaxValue(1000))
        .addIntegerOption((o) => o.setName("cooldown").setDescription("Cooldown seconds").setMinValue(0).setMaxValue(3600))
        .addBooleanOption((o) => o.setName("announce").setDescription("Announce level ups"))
      )
      .addSubcommand((sub) => sub.setName("rank").setDescription("Show rank")
        .addUserOption((o) => o.setName("user").setDescription("User")))
      .addSubcommand((sub) => sub.setName("top").setDescription("Show leaderboard")),
    new SlashCommandBuilder()
      .setName("security")
      .setDescription("Security / anti-raid")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure anti-raid")
          .addIntegerOption((o) => o.setName("max-joins").setDescription("Joins in the window").setMinValue(2).setMaxValue(200).setRequired(true))
          .addIntegerOption((o) => o.setName("window").setDescription("Window in seconds").setMinValue(5).setMaxValue(300).setRequired(true))
          .addIntegerOption((o) => o.setName("max-destructive").setDescription("Destructive actions before alert").setMinValue(2).setMaxValue(100))
          .addIntegerOption((o) => o.setName("destructive-window").setDescription("Destructive action window in seconds").setMinValue(5).setMaxValue(300))
          .addRoleOption((o) => o.setName("quarantine-role").setDescription("Optional quarantine role"))
          .addChannelOption((o) => o.setName("log-channel").setDescription("Security log channel").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((sub) => sub.setName("status").setDescription("Show current security state")),
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
      .addSubcommand((sub) => sub.setName("shuffle").setDescription("Shuffle the queue"))
      .addSubcommand((sub) =>
        sub
          .setName("repeat")
          .setDescription("Set repeat mode")
          .addStringOption((o) =>
            o.setName("mode")
              .setDescription("Repeat mode")
              .addChoices(
                { name: "Off", value: "off" },
                { name: "Track", value: "track" },
                { name: "Queue", value: "queue" }
              )
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("autoplay")
          .setDescription("Enable or disable autoplay")
          .addBooleanOption((o) => o.setName("enabled").setDescription("Autoplay state"))
      )
      .addSubcommand((sub) =>
        sub
          .setName("seek")
          .setDescription("Seek within the current track")
          .addIntegerOption((o) => o.setName("seconds").setDescription("Position in seconds").setMinValue(0).setMaxValue(86400).setRequired(true))
      )
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
          .addChannelOption((option) =>
            option.setName("channel").setDescription("Optional event channel filter")
          )
          .addStringOption((option) =>
            option.setName("match").setDescription("Optional message text filter").setMaxLength(200)
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
  if (interaction.commandName === "help") {
    const rows = await db.query<{ command_name: string; help_visible: boolean }>(
      "SELECT command_name,help_visible FROM command_policies WHERE guild_id=$1 AND enabled=true AND slash_enabled=true AND help_visible=true ORDER BY command_name",
      [interaction.guild!.id]
    );
    const custom = await db.query<{ name: string; description: string }>(
      "SELECT name,description FROM custom_commands WHERE guild_id=$1 AND enabled=true AND slash_enabled=true ORDER BY name",
      [interaction.guild!.id]
    );
    const builtIn = [...new Set(rows.rows.map((row) => row.command_name).filter((name) => name !== "help"))];
    const text = [
      "**Vexa — команды**",
      builtIn.length ? builtIn.map((name) => `/${name}`).join(", ") : "Нет доступных slash-команд.",
      custom.rows.length ? "\n**Custom Commands**\n" + custom.rows.map((row) => `/${row.name} — ${row.description || "custom command"}`).join("\n") : ""
    ].filter(Boolean).join("\n");
    await interaction.reply({ content: text.slice(0, 3900), ephemeral: true });
    return;
  }

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

  if (interaction.commandName === "clear") {
    await moderation.purge(interaction, interaction.options.getInteger("amount", true));
    return;
  }
  if (interaction.commandName === "slowmode") {
    await moderation.slowmode(interaction, interaction.options.getInteger("seconds", true));
    return;
  }
  if (interaction.commandName === "lock") {
    await moderation.lockChannel(interaction);
    return;
  }
  if (interaction.commandName === "unlock") {
    await moderation.unlockChannel(interaction);
    return;
  }

  if (["ban", "timeout", "kick", "warn", "unban"].includes(interaction.commandName)) {
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);

    if (interaction.commandName === "warn") {
      await moderation.warn(interaction, target, reason);
      return;
    }

    if (interaction.commandName === "unban") {
      await moderation.unban(interaction, target, reason);
      return;
    }

    const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "Пользователь не найден среди участников сервера.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "kick") {
      await moderation.kick(interaction, member, reason);
      return;
    }

    const rawDuration = interaction.options.getString("duration", true);
    const durationMinutes = parseDurationMinutes(rawDuration);
    if (durationMinutes === null) {
      await interaction.reply({ content: "Некорректная длительность. Пример: 30m, 2h, 7d.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "timeout") {
      await moderation.timeout(interaction, member, durationMinutes, reason);
    } else {
      await moderation.ban(interaction, member, reason, durationMinutes);
    }
    return;
  }

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

      const checker = new PermissionChecker(interaction.guild!);
      const missing = checker.botMissing(PermissionChecker.requiredForTemporaryVoice());
      if (missing.length > 0) {
        await interaction.reply({
          content: `Нельзя включить Temporary Voice. Не хватает прав у бота: ${missing.join(", ")}`,
          ephemeral: true
        });
        return;
      }

      await temporaryVoice.configure(interaction.guild!.id, {
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
        guildId: interaction.guild!.id,
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

  if (subcommand === "history" || subcommand === "note") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Недостаточно прав.", ephemeral: true });
      return;
    }

    if (subcommand === "note") {
      const action = interaction.options.getString("action", true);
      const noteText = interaction.options.getString("text")?.trim() ?? "";
      if (action === "add") {
        if (!noteText) {
          await interaction.reply({ content: "Для добавления заметки укажи text.", ephemeral: true });
          return;
        }
        const noteId = await moderation.addNote(
          interaction.guild!.id,
          target.id,
          interaction.user.id,
          noteText
        );
        await interaction.reply({ content: `Приватная moderation note #${noteId} сохранена.`, ephemeral: true });
        return;
      }

      const notes = await moderation.notes(interaction.guild!.id, target.id, 20);
      const content = notes.length === 0
        ? "Приватных заметок нет."
        : notes.map((item) =>
            `#${item.id} · <@!${item.moderatorUserId}> · ${item.note} · <t:${Math.floor(item.createdAt.getTime() / 1000)}:R>`
          ).join("\n");
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const limit = interaction.options.getInteger("limit") ?? 10;
    const cases = await moderation.history(interaction.guild!.id, target.id, limit);
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

  const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
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

function parseDurationMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\\d+)\\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const multiplier = unit === "w" ? 7 * 24 * 60 : unit === "d" ? 24 * 60 : unit === "h" ? 60 : 1;
  const minutes = amount * multiplier;
  return Number.isSafeInteger(minutes) && minutes <= 40320 ? minutes : null;
}
