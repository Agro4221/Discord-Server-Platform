import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message
} from "discord.js";
import type { Store } from "./db.js";
import { config } from "./config.js";
import { MusicService } from "./music.js";
import { TemporaryVoiceService } from "./temp-voice.js";
import { AnnouncementService } from "./announcements.js";

const MUSIC_COMMANDS = [
  "play",
  "queue",
  "skip",
  "pause",
  "resume",
  "stop",
  "clearqueue"
] as const;

type MusicCommand = (typeof MUSIC_COMMANDS)[number];

export class DiscordBot {
  readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      ...(config.commandPrefix ? [GatewayIntentBits.MessageContent] : [])
    ]
  });

  readonly music = new MusicService();
  readonly tempVoice: TemporaryVoiceService;
  readonly announcements: AnnouncementService;

  constructor(private readonly store: Store) {
    this.tempVoice = new TemporaryVoiceService(store);
    this.announcements = new AnnouncementService(this.client, store);

    this.client.once(Events.ClientReady, async (readyClient) => {
      console.log("[discord] logged in as " + readyClient.user.tag);
      if (config.commandPrefix) {
        console.log(
          "[discord] prefix commands enabled: " + config.commandPrefix
        );
        console.log(
          "[discord] enable Message Content Intent in the Discord Developer Portal."
        );
      }

      await this.tempVoice.reconcile(readyClient.guilds.cache.values());
      this.announcements.start();
    });

    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      void this.tempVoice.handleVoiceState(oldState, newState).catch((error) => {
        console.error("[temp-voice]", error);
      });
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      void this.handleInteraction(interaction).catch(async (error) => {
        console.error("[command]", error);
        const message =
          error instanceof Error ? error.message : "Внутренняя ошибка.";

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: message,
            flags: MessageFlags.Ephemeral
          }).catch(() => undefined);
        } else {
          await interaction.reply({
            content: message,
            flags: MessageFlags.Ephemeral
          }).catch(() => undefined);
        }
      });
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handlePrefixMessage(message).catch((error) => {
        console.error("[prefix-command]", error);
      });
    });

    this.client.on(Events.Error, (error) => {
      console.error("[discord]", error);
    });
  }

  async start(): Promise<void> {
    await this.music.checkDependencies();

    try {
      await this.client.login(config.discordToken);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          "Не удалось войти в Discord. Проверь DISCORD_TOKEN в .env. " +
          "Если токен был перевыпущен в Developer Portal, вставь новый токен. " +
          "Исходная ошибка: " +
          error.message
        );
      }
      throw error;
    }

    const applicationId = this.client.user?.id;
    if (!applicationId) {
      throw new Error("Discord не вернул application ID после входа.");
    }

    if (config.discordClientId && config.discordClientId !== applicationId) {
      throw new Error(
        "DISCORD_CLIENT_ID не совпадает с приложением, которому принадлежит DISCORD_TOKEN. " +
        "Используй Application ID этого же Discord-бота."
      );
    }

    const rest = new REST({ version: "10" }).setToken(config.discordToken);
    const commands = this.buildCommands().map((command) => command.toJSON());

    try {
      if (config.discordTestGuildId) {
        await rest.put(
          Routes.applicationGuildCommands(
            applicationId,
            config.discordTestGuildId
          ),
          { body: commands }
        );
      } else {
        await rest.put(
          Routes.applicationCommands(applicationId),
          { body: commands }
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          "Не удалось зарегистрировать slash-команды: " + error.message
        );
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.announcements.stop();
    await this.music.shutdown();
    this.client.destroy();
  }

  private buildCommands(): SlashCommandBuilder[] {
    const commands: SlashCommandBuilder[] = [
      new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Проверить, что бот отвечает"),

      new SlashCommandBuilder()
        .setName("play")
        .setDescription("Добавить трек или YouTube-плейлист")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Название, URL или YouTube-плейлист")
            .setRequired(true)
            .setMaxLength(500)
        ),

      new SlashCommandBuilder()
        .setName("queue")
        .setDescription("Показать текущий трек и очередь"),

      new SlashCommandBuilder()
        .setName("skip")
        .setDescription("Переключить на следующий трек"),

      new SlashCommandBuilder()
        .setName("pause")
        .setDescription("Поставить музыку на паузу"),

      new SlashCommandBuilder()
        .setName("resume")
        .setDescription("Продолжить музыку после паузы"),

      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Остановить музыку и очистить очередь"),

      new SlashCommandBuilder()
        .setName("clearqueue")
        .setDescription("Очистить очередь, не останавливая текущий трек"),

      new SlashCommandBuilder()
        .setName("music")
        .setDescription("Старый групповой формат музыкальных команд")
        .addSubcommand((sub) =>
          sub
            .setName("play")
            .setDescription("Добавить трек")
            .addStringOption((option) =>
              option
                .setName("query")
                .setDescription("Название или URL")
                .setRequired(true)
                .setMaxLength(500)
            )
        )
        .addSubcommand((sub) =>
          sub.setName("queue").setDescription("Показать очередь")
        )
        .addSubcommand((sub) =>
          sub.setName("skip").setDescription("Следующий трек")
        )
        .addSubcommand((sub) =>
          sub.setName("pause").setDescription("Пауза")
        )
        .addSubcommand((sub) =>
          sub.setName("resume").setDescription("Продолжить")
        )
        .addSubcommand((sub) =>
          sub.setName("stop").setDescription("Остановить и очистить очередь")
        )
        .addSubcommand((sub) =>
          sub
            .setName("clearqueue")
            .setDescription("Очистить очередь, не останавливая текущий трек")
        )
    ];

    return commands;
  }

  private async handleInteraction(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (interaction.inGuild() && interaction.guild) {
      const commandChannelId = this.store.getCommandChannel(interaction.guild.id);

      if (commandChannelId && interaction.channelId !== commandChannelId) {
        const channel = interaction.guild.channels.cache.get(commandChannelId);
        const channelMention = channel
          ? "<#" + commandChannelId + ">"
          : "настроенном канале";

        await interaction.reply({
          content:
            "Команды этого бота доступны в " +
            channelMention +
            ". " +
            "Музыка: /play, /queue, /skip, /pause, /resume, /stop, /clearqueue.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: "Pong · Gateway " + Math.round(this.client.ws.ping) + "ms",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (
      !interaction.inGuild() ||
      !interaction.guild ||
      !this.isMusicCommandName(interaction.commandName)
    ) {
      return;
    }

    const member = interaction.member as GuildMember;
    const command =
      interaction.commandName === "music"
        ? interaction.options.getSubcommand() as MusicCommand
        : interaction.commandName as MusicCommand;

    const query =
      command === "play"
        ? interaction.commandName === "music"
          ? interaction.options.getString("query", true)
          : interaction.options.getString("query", true)
        : undefined;

    await this.executeMusic(
      interaction.guild.id,
      interaction.guild,
      member,
      command,
      query,
      async (content) => {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(content);
        } else {
          await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
          });
        }
      },
      async () => {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
      }
    );
  }

  private async handlePrefixMessage(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild() || !message.guild) return;

    const prefix = config.commandPrefix;
    if (!prefix || !message.content.startsWith(prefix)) return;

    const raw = message.content.slice(prefix.length).trim();
    if (!raw) return;

    const parts = raw.split(/\s+/);
    let commandName = parts.shift()?.toLowerCase() ?? "";

    if (!commandName) return;

    if (commandName === "music") {
      commandName = parts.shift()?.toLowerCase() ?? "";
    }

    if (!this.isMusicCommandName(commandName) && commandName !== "ping") {
      return;
    }

    const commandChannelId = this.store.getCommandChannel(message.guild.id);

    if (commandChannelId && message.channelId !== commandChannelId) {
      const channel = message.guild.channels.cache.get(commandChannelId);
      await message.reply(
        "Команды этого бота доступны в " +
          (channel ? "<#" + commandChannelId + ">" : "настроенном канале") +
          "."
      );
      return;
    }

    if (commandName === "ping") {
      await message.reply(
        "Pong · Gateway " + Math.round(this.client.ws.ping) + "ms"
      );
      return;
    }

    const query = commandName === "play"
      ? parts.join(" ").trim()
      : undefined;

    if (commandName === "play" && !query) {
      await message.reply(
        "После !play укажи название трека, ссылку или YouTube-плейлист."
      );
      return;
    }

    const member = message.member;
    if (!member) return;

    await this.executeMusic(
      message.guild.id,
      message.guild,
      member,
      commandName as MusicCommand,
      query,
      (content) => message.reply(content),
      async () => undefined
    );
  }

  private isMusicCommandName(value: string): value is MusicCommand {
    return (MUSIC_COMMANDS as readonly string[]).includes(value);
  }

  private async executeMusic(
    guildId: string,
    guild: NonNullable<ChatInputCommandInteraction["guild"]>,
    member: GuildMember,
    command: MusicCommand,
    query: string | undefined,
    reply: (content: string) => Promise<void>,
    defer: () => Promise<void>
  ): Promise<void> {
    if (command === "play") {
      await defer();
      const track = await this.music.play(guild, member, query ?? "");
      await reply(
        "Добавлено: **" + track.title + "**.\n" +
        (this.music.isPaused(guildId)
          ? "Сейчас музыка на паузе — используй /resume или !resume, чтобы продолжить."
          : "")
      );
      return;
    }

    if (command === "skip") {
      const next = await this.music.skip(guildId);
      await reply(
        next
          ? "Скип. Следом: **" + next.title + "**"
          : "Очередь пуста."
      );
      return;
    }

    if (command === "pause") {
      await reply(
        this.music.pause(guildId)
          ? "Пауза. Текущий трек и очередь сохранены. Для продолжения: /resume или !resume."
          : "Музыка не запущена."
      );
      return;
    }

    if (command === "resume") {
      await reply(
        this.music.resume(guildId)
          ? "Продолжаю текущий трек."
          : "Музыка не находится на паузе."
      );
      return;
    }

    if (command === "clearqueue") {
      await reply(
        this.music.clearQueue(guildId)
          ? "Очередь очищена. Текущий трек не остановлен."
          : "Музыка ещё не запущена."
      );
      return;
    }

    if (command === "stop") {
      this.music.stop(guildId);
      await reply("Музыка остановлена, очередь очищена.");
      return;
    }

    const queue = this.music.queue(guildId);
    const lines = [
      queue.current
        ? "Сейчас: **" + queue.current.title + "**"
        : "Сейчас ничего не играет.",
      "Пауза: " + (this.music.isPaused(guildId) ? "да" : "нет"),
      queue.items.length
        ? "В очереди: " + queue.items.length
        : "В очереди ничего нет.",
      ...queue.items.slice(0, 10).map(
        (track, index) => (index + 1) + ". " + track.title
      )
    ];

    await reply(lines.join("\n").slice(0, 1900));
  }
}
