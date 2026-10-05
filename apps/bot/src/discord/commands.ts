import {
  ChannelType,
  EmbedBuilder,
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
import { getGuildLocale, t } from "../localization.js";
import { TemporaryVoice } from "../modules/temporary-voice.js";
import { Moderation } from "../modules/moderation.js";
import { COMMAND_DEFINITIONS } from "../command-policy.js";
import type { HelpPages } from "../help-pages.js";

export function buildCommands(): Array<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder> {
  return [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show available Vexa commands")
      .addStringOption((o) => o.setName("page").setDescription("Optional custom help page slug").setMaxLength(40)),

    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check platform health"),

    new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Show server information"),

    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show user information")
      .addUserOption((o) => o.setName("user").setDescription("User")),

    new SlashCommandBuilder()
      .setName("roleinfo")
      .setDescription("Show role information")
      .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),

    new SlashCommandBuilder()
      .setName("channelinfo")
      .setDescription("Show channel information")
      .addChannelOption((o) => o.setName("channel").setDescription("Channel")),

    new SlashCommandBuilder()
      .setName("embed")
      .setDescription("Create an embed message")
      .addStringOption((o) => o.setName("title").setDescription("Embed title").setMaxLength(256))
      .addStringOption((o) => o.setName("description").setDescription("Embed description").setMaxLength(4096))
      .addStringOption((o) => o.setName("url").setDescription("Optional URL").setMaxLength(2000))
      .addStringOption((o) => o.setName("color").setDescription("Hex color, e.g. #5865F2").setMaxLength(7))
      .addStringOption((o) => o.setName("footer").setDescription("Footer text").setMaxLength(2048))
      .addStringOption((o) => o.setName("image").setDescription("Image URL").setMaxLength(2000))
      .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail URL").setMaxLength(2000)),

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
      .addStringOption((o) => o.setName("query").setDescription("Song, URL or playlist").setMaxLength(2000).setRequired(true))
      .addStringOption((o) => o.setName("provider").setDescription("Search provider").addChoices(
        { name: "YouTube", value: "youtube" },
        { name: "Yandex Music", value: "yandex" },
        { name: "Spotify", value: "spotify" },
        { name: "Apple Music", value: "applemusic" },
        { name: "Deezer", value: "deezer" },
        { name: "VK Music", value: "vkmusic" },
        { name: "Tidal", value: "tidal" }
      )),
    new SlashCommandBuilder().setName("pause").setDescription("Pause music"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume music"),
    new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
    new SlashCommandBuilder()
      .setName("queue-limit")
      .setDescription("Configure pending tracks limit per user")
      .addIntegerOption((o) => o.setName("limit").setDescription("0 = unlimited, maximum 100").setMinValue(0).setMaxValue(100)),
    new SlashCommandBuilder()
      .setName("queue-size")
      .setDescription("Configure total pending queue size")
      .addIntegerOption((o) => o.setName("size").setDescription("0 = unlimited, maximum 500").setMinValue(0).setMaxValue(500)),
    new SlashCommandBuilder().setName("vote-skip").setDescription("Vote to skip the current track"),
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
      .setName("pitch")
      .setDescription("Show or change pitch")
      .addNumberOption((o) => o.setName("value").setDescription("0.5-2.0, 1.0 = normal").setMinValue(0.5).setMaxValue(2).setRequired(false)),
    new SlashCommandBuilder()
      .setName("speed")
      .setDescription("Show or change playback speed")
      .addNumberOption((o) => o.setName("value").setDescription("0.5-2.0, 1.0 = normal").setMinValue(0.5).setMaxValue(2).setRequired(false)),
    new SlashCommandBuilder()
      .setName("eq")
      .setDescription("Show or edit the 15-band equalizer")
      .addStringOption((o) => o.setName("action").setDescription("EQ action").addChoices(
        { name: "Show", value: "show" },
        { name: "Set band", value: "set" },
        { name: "Reset", value: "reset" }
      ).setRequired(true))
      .addIntegerOption((o) => o.setName("band").setDescription("EQ band 0-14").setMinValue(0).setMaxValue(14))
      .addNumberOption((o) => o.setName("gain").setDescription("Gain -0.25 to 1.00").setMinValue(-0.25).setMaxValue(1)),
    new SlashCommandBuilder()
      .setName("autoplay")
      .setDescription("Show or change autoplay")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Autoplay state")),
    new SlashCommandBuilder()
      .setName("radio")
      .setDescription("Start or stop radio by artist, genre or search seed")
      .addStringOption((o) => o.setName("action").setDescription("Radio action").addChoices(
        { name: "Start", value: "start" },
        { name: "Stop", value: "stop" },
        { name: "Status", value: "status" }
      ).setRequired(true))
      .addStringOption((o) => o.setName("mode").setDescription("Radio seed type").addChoices(
        { name: "Artist", value: "artist" },
        { name: "Genre", value: "genre" },
        { name: "Search", value: "search" }
      ))
      .addStringOption((o) => o.setName("seed").setDescription("Artist, genre or search seed").setMaxLength(200)),
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
      )
      .addSubcommand((sub) =>
        sub
          .setName("escalation")
          .setDescription("Configure automatic escalation by warning count")
          .addStringOption((option) =>
            option.setName("action").setDescription("Action").addChoices(
              { name: "Set", value: "set" },
              { name: "List", value: "list" },
              { name: "Remove", value: "remove" }
            ).setRequired(true)
          )
          .addIntegerOption((option) =>
            option.setName("warn-count").setDescription("Warning threshold").setMinValue(1).setMaxValue(100)
          )
          .addStringOption((option) =>
            option.setName("punishment").setDescription("timeout or ban").addChoices(
              { name: "Timeout", value: "timeout" },
              { name: "Ban", value: "ban" }
            )
          )
          .addIntegerOption((option) =>
            option.setName("minutes").setDescription("Duration; 0 = permanent ban").setMinValue(0).setMaxValue(40320)
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Reason").setMaxLength(500)
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
          .setName("reopen")
          .setDescription("Reopen a closed ticket")
          .addIntegerOption((o) => o.setName("id").setDescription("Ticket id").setMinValue(1).setRequired(true))
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
              .setName("component")
              .setDescription("Panel component")
              .addChoices(
                { name: "Buttons", value: "buttons" },
                { name: "Select menu", value: "select" }
              )
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
          .addIntegerOption((option) =>
            option.setName("duration").setDescription("Role duration in minutes; 0 = permanent").setMinValue(0).setMaxValue(43200)
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
          .addRoleOption((option) =>
            option
              .setName("required-role")
              .setDescription("Role required to participate")
          )
          .addIntegerOption((option) =>
            option
              .setName("min-level")
              .setDescription("Minimum server level required")
              .setMinValue(0)
              .setMaxValue(1000)
          )
          .addStringOption((option) =>
            option
              .setName("template")
              .setDescription("Optional announcement template")
              .setMaxLength(1000)
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
      .setName("afk")
      .setDescription("Set or clear AFK status")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("AFK reason; use off/clear to remove")
          .setMaxLength(500)
      ),

    new SlashCommandBuilder()
      .setName("schedule")
      .setDescription("Schedule a message in a channel")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("Delay in minutes")
          .setMinValue(1)
          .setMaxValue(525600)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Destination channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Message text")
          .setMaxLength(2000)
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("sticky")
      .setDescription("Manage a sticky message")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Create or update a sticky message")
          .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addStringOption((o) => o.setName("text").setDescription("Sticky content").setMaxLength(2000).setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a sticky message")
          .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List sticky messages")
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
          .addStringOption((o) => o.setName("panel-title").setDescription("Verification panel title").setMaxLength(256))
          .addStringOption((o) => o.setName("panel-description").setDescription("Verification panel description").setMaxLength(4096))
          .addStringOption((o) => o.setName("issue-button").setDescription("Button label for issuing a code").setMaxLength(80))
          .addStringOption((o) => o.setName("confirm-button").setDescription("Button label for confirmation").setMaxLength(80))
      )
      .addSubcommand((sub) =>
        sub
          .setName("panel")
          .setDescription("Publish verification panel")
          .addChannelOption((o) => o.setName("channel").setDescription("Panel channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      ),
    new SlashCommandBuilder()
      .setName("form")
      .setDescription("Reusable server forms")
      .addSubcommand((sub) =>
        sub
          .setName("publish")
          .setDescription("Publish a saved form")
          .addStringOption((o) => o.setName("name").setDescription("Form name").setMaxLength(40).setRequired(true))
          .addChannelOption((o) => o.setName("channel").setDescription("Optional panel channel").addChannelTypes(ChannelType.GuildText))
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
      .setName("invites")
      .setDescription("Show invite statistics")
      .addUserOption((o) => o.setName("user").setDescription("User")),

    new SlashCommandBuilder()
      .setName("achievements")
      .setDescription("Show community achievements")
      .addUserOption((o) => o.setName("user").setDescription("User")),

    new SlashCommandBuilder()
      .setName("birthday")
      .setDescription("Manage birthdays")
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Save your birthday")
          .addIntegerOption((o) => o.setName("month").setDescription("Month 1-12").setMinValue(1).setMaxValue(12).setRequired(true))
          .addIntegerOption((o) => o.setName("day").setDescription("Day 1-31").setMinValue(1).setMaxValue(31).setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("remove").setDescription("Remove your birthday"))
      .addSubcommand((sub) => sub.setName("list").setDescription("List birthdays"))
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Configure birthday announcement channel")
          .addChannelOption((o) => o.setName("channel").setDescription("Announcement channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addStringOption((o) => o.setName("template").setDescription("Template: {user} {server}").setMaxLength(500))
      ),

    new SlashCommandBuilder()
      .setName("rep")
      .setDescription("Community reputation")
      .addSubcommand((sub) =>
        sub
          .setName("give")
          .setDescription("Give +1 rep")
          .addUserOption((o) => o.setName("user").setDescription("Recipient").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("check")
          .setDescription("Check reputation")
          .addUserOption((o) => o.setName("user").setDescription("User"))
      )
      .addSubcommand((sub) => sub.setName("leaderboard").setDescription("Top reputation scores")),

    new SlashCommandBuilder()
      .setName("profile")
      .setDescription("Community social profile")
      .addUserOption((o) => o.setName("user").setDescription("User"))
      .addStringOption((o) => o.setName("bio").setDescription("Set bio").setMaxLength(500)),

    new SlashCommandBuilder()
      .setName("suggestion")
      .setDescription("Community suggestions")
      .addSubcommand((sub) =>
        sub
          .setName("create")
          .setDescription("Publish a suggestion")
          .addStringOption((o) => o.setName("text").setDescription("Suggestion text").setMaxLength(2000).setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("review")
          .setDescription("Approve or reject a suggestion")
          .addIntegerOption((o) => o.setName("id").setDescription("Suggestion id").setMinValue(1).setRequired(true))
          .addStringOption((o) =>
            o.setName("action").setDescription("Decision").addChoices(
              { name: "Approve", value: "approve" },
              { name: "Reject", value: "reject" }
            ).setRequired(true)
          )
          .addStringOption((o) => o.setName("reason").setDescription("Optional staff comment").setMaxLength(500))
      ),

    new SlashCommandBuilder()
      .setName("analytics")
      .setDescription("Server analytics"),

    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Show live server statistics"),
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
        .addStringOption((o) => o.setName("image").setDescription("Welcome image HTTPS URL").setMaxLength(2000))
        .addStringOption((o) => o.setName("goodbye-image").setDescription("Goodbye image HTTPS URL").setMaxLength(2000))
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
          .addBooleanOption((o) => o.setName("raid-quarantine").setDescription("Quarantine members while Anti-Raid is active"))
          .addBooleanOption((o) => o.setName("destructive-role-removal").setDescription("Remove manageable roles from destructive actors"))
          .addBooleanOption((o) => o.setName("destructive-quarantine").setDescription("Quarantine destructive actors"))
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
      )
      .addSubcommand((sub) =>
        sub
          .setName("github")
          .setDescription("Track a GitHub repository")
          .addStringOption((o) => o.setName("repo").setDescription("owner/repository").setMaxLength(200).setRequired(true))
          .addStringOption((o) => o.setName("type").setDescription("Event feed").addChoices(
            { name: "Releases", value: "releases" },
            { name: "Commits", value: "commits" }
          ).setRequired(true))
          .addChannelOption((o) => o.setName("channel").setDescription("Destination channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addIntegerOption((o) => o.setName("minutes").setDescription("Polling interval").setMinValue(1).setMaxValue(1440))
      ),
    new SlashCommandBuilder()
      .setName("streamalert")
      .setDescription("Stream live alerts")
      .addSubcommand((sub) => sub
        .setName("create")
        .setDescription("Create a live notification")
        .addStringOption((o) => o.setName("platform").setDescription("Platform").addChoices(
          { name: "Twitch", value: "twitch" },
          { name: "YouTube", value: "youtube" },
          { name: "VK Live", value: "vk" },
          { name: "Kick", value: "kick" }
        ).setRequired(true))
        .addStringOption((o) => o.setName("target").setDescription("Channel login, handle, slug or broadcaster ID").setMaxLength(200).setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Discord destination").addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption((o) => o.setName("mention-role").setDescription("Optional role to mention"))
        .addIntegerOption((o) => o.setName("interval").setDescription("Polling interval in seconds").setMinValue(15).setMaxValue(3600))
      ),

    new SlashCommandBuilder()
      .setName("music")
      .setDescription("Music player")
      .addSubcommand((sub) =>
        sub
          .setName("play")
           .setDescription("Play a song, playlist or provider search")
          .addStringOption((o) => o.setName("query").setDescription("Song, artist, URL or playlist").setMaxLength(2000).setRequired(true))
           .addStringOption((o) => o.setName("provider").setDescription("Search provider").addChoices(
             { name: "YouTube", value: "youtube" },
             { name: "Yandex Music", value: "yandex" },
             { name: "Spotify", value: "spotify" },
             { name: "Apple Music", value: "applemusic" },
             { name: "Deezer", value: "deezer" },
             { name: "VK Music", value: "vkmusic" },
             { name: "Tidal", value: "tidal" }
           ))
      )
      .addSubcommand((sub) =>
        sub
          .setName("search")
          .setDescription("Search tracks and choose a result")
          .addStringOption((o) => o.setName("query").setDescription("Search query").setMaxLength(2000).setRequired(true))
           .addStringOption((o) => o.setName("provider").setDescription("Search provider").addChoices(
             { name: "YouTube", value: "youtube" },
             { name: "Yandex Music", value: "yandex" },
             { name: "Spotify", value: "spotify" },
             { name: "Apple Music", value: "applemusic" },
             { name: "Deezer", value: "deezer" },
             { name: "VK Music", value: "vkmusic" },
             { name: "Tidal", value: "tidal" }
           ))
      )
      .addSubcommand((sub) => sub.setName("resume").setDescription("Resume playback"))
      .addSubcommand((sub) => sub.setName("previous").setDescription("Play previous track"))
      .addSubcommand((sub) => sub.setName("lyrics").setDescription("Show lyrics for the current track"))
      .addSubcommand((sub) => sub.setName("skip").setDescription("Skip current track"))
      .addSubcommand((sub) => sub.setName("vote-skip").setDescription("Vote to skip the current track"))
      .addSubcommand((sub) =>
        sub
          .setName("skip-to")
          .setDescription("Skip to a queued track")
          .addIntegerOption((o) => o.setName("position").setDescription("Queue position").setMinValue(1).setMaxValue(500).setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("history").setDescription("Show recently played tracks"))
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
          .setName("247")
          .setDescription("Keep the music bot in voice 24/7")
          .addBooleanOption((o) => o.setName("enabled").setDescription("24/7 state"))
      )
      .addSubcommand((sub) => sub.setName("providers").setDescription("Show configured music providers"))
      .addSubcommand((sub) => sub
        .setName("queue-policy")
        .setDescription("Configure who may add tracks to the queue")
        .addStringOption((o) => o.setName("mode").setDescription("Queue access").addChoices(
          { name: "Everyone", value: "everyone" },
          { name: "DJ only", value: "dj" }
        )))
      .addSubcommand((sub) => sub
        .setName("queue-limit")
        .setDescription("Configure pending tracks limit per user")
        .addIntegerOption((o) => o.setName("limit").setDescription("0 = unlimited, maximum 100").setMinValue(0).setMaxValue(100)))
      .addSubcommand((sub) => sub
        .setName("queue-size")
        .setDescription("Configure total pending queue size")
        .addIntegerOption((o) => o.setName("size").setDescription("0 = unlimited, maximum 500").setMinValue(0).setMaxValue(500)))
      .addSubcommand((sub) =>
        sub
          .setName("seek")
          .setDescription("Seek within the current track")
          .addIntegerOption((o) => o.setName("seconds").setDescription("Position in seconds").setMinValue(0).setMaxValue(86400).setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("queue")
          .setDescription("Show or edit the queue")
          .addStringOption((o) => o.setName("action").setDescription("Queue operation").addChoices(
            { name: "View", value: "view" },
            { name: "Export queue", value: "export" },
            { name: "Share queue", value: "share" },
            { name: "Remove track", value: "remove" },
            { name: "Remove range", value: "remove-range" },
            { name: "Move track", value: "move" },
            { name: "Move to front", value: "front" },
            { name: "Clear queue", value: "clear" }
          ))
          .addIntegerOption((o) => o.setName("position").setDescription("Track position in queue").setMinValue(1).setMaxValue(500))
          .addIntegerOption((o) => o.setName("to").setDescription("Destination position for move").setMinValue(1).setMaxValue(500))
          .addIntegerOption((o) => o.setName("from").setDescription("Start position for range remove").setMinValue(1).setMaxValue(500))
          .addIntegerOption((o) => o.setName("end").setDescription("End position for range remove").setMinValue(1).setMaxValue(500))
      )
      .addSubcommand((sub) => sub.setName("nowplaying").setDescription("Show current track"))
      .addSubcommand((sub) =>
        sub
          .setName("volume")
          .setDescription("Show/change volume")
          .addIntegerOption((o) => o.setName("value").setDescription("0-200").setMinValue(0).setMaxValue(200))
      )
      .addSubcommand((sub) =>
        sub
          .setName("filter")
          .setDescription("Audio filters")
          .addStringOption((o) =>
            o.setName("action").setDescription("Filter action").addChoices(
              { name: "Clear filters", value: "clear" },
              { name: "Bassboost low", value: "bassboost-low" },
              { name: "Bassboost medium", value: "bassboost-medium" },
              { name: "Bassboost high", value: "bassboost-high" },
              { name: "Rock", value: "rock" },
              { name: "Classic", value: "classic" },
              { name: "Pop", value: "pop" },
              { name: "Electronic", value: "electronic" },
              { name: "Full sound", value: "fullsound" },
              { name: "Karaoke", value: "karaoke" },
              { name: "Tremolo", value: "tremolo" },
              { name: "Vibrato", value: "vibrato" },
              { name: "Distortion", value: "distortion" },
              { name: "Low pass", value: "lowpass" },
              { name: "Channel mix", value: "channelmix" },
              { name: "Gaming", value: "gaming" },
              { name: "Nightcore", value: "nightcore" },
              { name: "8D rotation", value: "8d" }
            ).setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("favorite")
          .setDescription("Manage personal favorites")
          .addStringOption((o) =>
            o.setName("action").setDescription("Action").addChoices(
              { name: "Add current", value: "add" },
              { name: "Remove current", value: "remove" },
              { name: "List", value: "list" },
              { name: "Play", value: "play" }
            ).setRequired(true)
          )
          .addIntegerOption((o) => o.setName("track").setDescription("Favorite number (1-based)").setMinValue(1).setMaxValue(25))
      )
      .addSubcommand((sub) =>
        sub
          .setName("playlist")
          .setDescription("Manage saved playlists")
          .addStringOption((o) =>
            o.setName("action").setDescription("Action").addChoices(
              { name: "Create", value: "create" },
              { name: "Delete", value: "delete" },
              { name: "List", value: "list" },
              { name: "Search", value: "search" },
              { name: "Save current queue", value: "save-queue" },
              { name: "Import URL", value: "import" },
              { name: "View tracks", value: "view" },
              { name: "Add current", value: "add" },
              { name: "Remove track", value: "remove" },
              { name: "Move track", value: "move" },
              { name: "Merge", value: "merge" },
              { name: "Play", value: "play" }
            ).setRequired(true)
          )
          .addStringOption((o) => o.setName("name").setDescription("Playlist name").setMaxLength(80))
          .addStringOption((o) => o.setName("query").setDescription("Search text for playlist names").setMaxLength(80))
          .addStringOption((o) => o.setName("source").setDescription("Source playlist name for merge").setMaxLength(80))
          .addIntegerOption((o) => o.setName("track").setDescription("Track number (1-based)").setMinValue(1).setMaxValue(500))
          .addIntegerOption((o) => o.setName("to").setDescription("New position for the track (1-based)").setMinValue(1).setMaxValue(500))
          .addBooleanOption((o) => o.setName("shuffle").setDescription("Shuffle tracks when loading the playlist"))
          .addBooleanOption((o) => o.setName("shared").setDescription("Create or update this playlist as a server-shared playlist"))
          .addBooleanOption((o) => o.setName("shared-only").setDescription("Search shared playlists only"))
      ),
    new SlashCommandBuilder()
      .setName("automation")
      .setDescription("Automation rules")
      .addSubcommand((sub) =>
        sub
          .setName("template")
          .setDescription("Manage reusable automation templates")
          .addStringOption((o) => o.setName("action").setDescription("Action").addChoices(
            { name: "Set", value: "set" },
            { name: "List", value: "list" },
            { name: "Delete", value: "delete" }
          ).setRequired(true))
          .addStringOption((o) => o.setName("name").setDescription("Template name, e.g. welcome").setMaxLength(40))
          .addStringOption((o) => o.setName("content").setDescription("Template content").setMaxLength(2000))
      )
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
  moderation: Moderation,
  helpPages?: HelpPages
): Promise<void> {
  const locale = interaction.guildId
    ? await getGuildLocale(db, interaction.guildId)
    : "ru";
  if (interaction.commandName === "help") {
    const requestedPage = interaction.options.getString("page")?.trim();
    if (requestedPage && helpPages) {
      const page = await helpPages.get(interaction.guild!.id, requestedPage);
      if (!page || !page.enabled) {
        await interaction.reply({ content: t(locale, "help-page-missing"), ephemeral: true });
        return;
      }
      await interaction.reply({
        content: "**" + page.title + "**\n" + page.content,
        ephemeral: true
      });
      return;
    }

    const rows = await db.query<{ command_name: string; enabled: boolean; slash_enabled: boolean; help_visible: boolean }>(
      "SELECT command_name,enabled,slash_enabled,help_visible FROM command_policies WHERE guild_id=$1",
      [interaction.guild!.id]
    );
    const storedPolicies = new Map(rows.rows.map((row) => [row.command_name, row]));

    const custom = await db.query<{ name: string; description: string }>(
      "SELECT name,description FROM custom_commands WHERE guild_id=$1 AND enabled=true AND slash_enabled=true ORDER BY name",
      [interaction.guild!.id]
    );
    const builtIn = COMMAND_DEFINITIONS
      .filter((definition) => definition.slash && definition.name !== "help")
      .filter((definition) => {
        const policy = storedPolicies.get(definition.name);
        return (policy?.enabled ?? true) && (policy?.slash_enabled ?? definition.slash) && (policy?.help_visible ?? true);
      })
      .map((definition) => `/${definition.name}`);
    const text = [
      "**" + t(locale, "help-title") + "**",
      builtIn.length ? builtIn.map((name) => `/${name}`).join(", ") : t(locale, "help-empty"),
      custom.rows.length ? "\n**Custom Commands**\n" + custom.rows.map((row) => `/${row.name} — ${row.description || "custom command"}`).join("\n") : ""
    ].filter(Boolean).join("\n");
    await interaction.reply({ content: text.slice(0, 3900), ephemeral: true });
    return;
  }

  if (interaction.commandName === "embed") {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: t(locale, "embed-permission"), ephemeral: true });
      return;
    }

    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const url = interaction.options.getString("url");
    const color = interaction.options.getString("color");
    const footer = interaction.options.getString("footer");
    const image = interaction.options.getString("image");
    const thumbnail = interaction.options.getString("thumbnail");

    if (!title && !description && !footer && !image && !thumbnail) {
      await interaction.reply({ content: t(locale, "embed-empty"), ephemeral: true });
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) {
      await interaction.reply({ content: t(locale, "url-http"), ephemeral: true });
      return;
    }
    if (image && !/^https?:\/\//i.test(image)) {
      await interaction.reply({ content: t(locale, "url-http"), ephemeral: true });
      return;
    }
    if (thumbnail && !/^https?:\/\//i.test(thumbnail)) {
      await interaction.reply({ content: t(locale, "url-http"), ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (url) embed.setURL(url);
    if (color) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        await interaction.reply({ content: t(locale, "color-format"), ephemeral: true });
        return;
      }
      embed.setColor(parseInt(color.slice(1), 16));
    }
    if (footer) embed.setFooter({ text: footer });
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);

    if (!interaction.channel || !interaction.channel.isTextBased() || !("send" in interaction.channel)) {
      await interaction.reply({ content: t(locale, "channel-send-unsupported"), ephemeral: true });
      return;
    }

    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({ content: t(locale, "embed-published"), ephemeral: true });
    return;
  }

  if (interaction.commandName === "serverinfo") {
    const guild = interaction.guild!;
    const owner = await guild.fetchOwner().catch(() => null);
    const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice).size;
    const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size;
    const embed = new EmbedBuilder().setTitle("🛡️ " + guild.name).addFields(
        { name: "ID", value: guild.id, inline: true },
        { name: "Участники", value: String(guild.memberCount), inline: true },
        { name: "Владелец", value: owner ? owner.user.toString() : guild.ownerId, inline: true },
        { name: "Каналы", value: "Текст: " + textChannels + " · Voice: " + voiceChannels + " · Категории: " + categories, inline: false },
        { name: "Роли", value: String(Math.max(0, guild.roles.cache.size - 1)), inline: true },
        { name: "Создан", value: "<t:" + Math.floor(guild.createdTimestamp / 1000) + ":F>", inline: true },
        { name: "Boost", value: guild.premiumTier + " · " + (guild.premiumSubscriptionCount ?? 0), inline: true }
      );
    const icon = guild.iconURL({ size: 128 });
    if (icon) embed.setThumbnail(icon);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "userinfo") {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    const roles = member ? member.roles.cache.filter((role) => role.id !== interaction.guild!.roles.everyone.id).sort((a,b) => b.position - a.position).map((role) => role.toString()).join(", ") : "";
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("👤 " + (user.globalName ?? user.username)).setThumbnail(user.displayAvatarURL({ size: 128 })).addFields(
        { name: "ID", value: user.id, inline: true },
        { name: "Создан", value: "<t:" + Math.floor(user.createdTimestamp / 1000) + ":F>", inline: true },
        { name: "На сервере", value: member?.joinedTimestamp ? "<t:" + Math.floor(member.joinedTimestamp / 1000) + ":F>" : "Не состоит", inline: true },
        { name: "Роли", value: (roles || "Нет").slice(0, 1000), inline: false }
      )],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "roleinfo") {
    const roleOption = interaction.options.getRole("role", true);
    const role = interaction.guild!.roles.cache.get(roleOption.id);
    if (!role) {
      await interaction.reply({ content: t(locale, "role-missing"), ephemeral: true });
      return;
    }
    const permissions = role.permissions.toArray().slice(0, 18).join(", ") || "Нет";
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("🏷️ " + role.name).addFields(
        { name: "ID", value: role.id, inline: true },
        { name: "Позиция", value: String(role.position), inline: true },
        { name: "Участники", value: String(role.members.size), inline: true },
        { name: "Цвет", value: role.hexColor, inline: true },
        { name: "Mentionable", value: role.mentionable ? "Да" : "Нет", inline: true },
        { name: "Managed", value: role.managed ? "Да" : "Нет", inline: true },
        { name: "Permissions", value: permissions, inline: false }
      )],
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "channelinfo") {
    const selectedChannel = interaction.options.getChannel("channel");
    const channel = interaction.guild!.channels.cache.get(selectedChannel?.id ?? interaction.channelId);
    if (!channel) {
      await interaction.reply({ content: "Канал не найден.", ephemeral: true });
      return;
    }
    const topic = "topic" in channel && typeof channel.topic === "string" ? channel.topic : null;
    const slowmode = "rateLimitPerUser" in channel && typeof channel.rateLimitPerUser === "number" ? channel.rateLimitPerUser : null;
    const details = ["ID: " + channel.id, "Тип: " + channel.type, "Категория: " + (channel.parent?.name ?? "—"), topic ? "Топик: " + topic : null, slowmode !== null ? "Slowmode: " + slowmode + "s" : null].filter(Boolean).join("\n");
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle("📺 #" + channel.name).setDescription(details.slice(0, 3900))], ephemeral: true });
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

  if (subcommand === "escalation") {
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const rules = await moderation.listEscalations(interaction.guild!.id);
      const content = rules.length
        ? "⚖️ **Escalation rules**\n" + rules.map((rule) =>
            `${rule.warnCount} warn → ${rule.action === "timeout" ? "timeout " + rule.durationMinutes + "m" : "ban" + (rule.durationMinutes > 0 ? " " + rule.durationMinutes + "m" : " permanent")} · ${rule.reason}`
          ).join("\n").slice(0,3900)
        : "Правил эскалации нет.";
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const warnCount = interaction.options.getInteger("warn-count", true);
    if (action === "remove") {
      const removed = await moderation.removeEscalation(interaction.guild!.id, warnCount);
      await interaction.reply({
        content: removed ? "Правило эскалации для " + warnCount + " warn удалено." : "Такого правила нет.",
        ephemeral: true
      });
      return;
    }

    const punishment = interaction.options.getString("punishment", true) as "timeout" | "ban";
    const minutes = interaction.options.getInteger("minutes") ?? 0;
    const reason = interaction.options.getString("reason")?.trim() || "Automatic moderation escalation";
    await moderation.setEscalation(interaction.guild!.id, warnCount, punishment, minutes, reason);
    await moderation.audit("moderation.escalation.configured", interaction.guild!.id, interaction.user.id, String(warnCount), {
      warnCount, punishment, minutes, reason
    });
    await interaction.reply({
      content: "✅ Эскалация настроена: " + warnCount + " warn → " + punishment + (punishment === "timeout" ? " на " + minutes + " мин." : (minutes > 0 ? " на " + minutes + " мин." : "")),
      ephemeral: true
    });
    return;
  }

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