import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction
} from "discord.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../database.js";
import { logger } from "../logger.js";
import { buildCommands, handleCommand } from "./commands.js";
import { TemporaryVoice } from "../modules/temporary-voice.js";
import { Moderation } from "../modules/moderation.js";
import type { PlatformEventBus } from "../events.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ]
  });
}

export async function registerCommands(
  config: AppConfig,
  _client: Client
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands().map((command) => command.toJSON());

  if (config.discordTestGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordTestGuildId
      ),
      { body: commands }
    );
    logger.info("Registered test-guild commands", {
      guildId: config.discordTestGuildId,
      count: commands.length
    });
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: commands
  });
  logger.info("Registered global commands", { count: commands.length });
}

export function wireDiscordEvents(
  client: Client,
  events: PlatformEventBus
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void events.emit("interaction", interaction);
    if (interaction.isChatInputCommand()) {
      void events.emit("interaction.command", interaction);
    }
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void events.emit("voice.state", { oldState, newState });
  });

  client.on(Events.MessageCreate, (message) => {
    void events.emit("message.create", message);
  });

  client.on(Events.MessageDelete, (message) => {
    if (!message.partial) {
      void events.emit("message.delete", message);
    }
  });

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!oldMessage.partial && !newMessage.partial) {
      void events.emit("message.update", { oldMessage, newMessage });
    }
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void emitReaction(events, reaction, user);
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void emitMemberAdd(events, member);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    void emitMemberRemove(events, member);
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void emitMemberUpdate(events, oldMember, newMember);
  });

  client.on(Events.ChannelDelete, (channel) => {
    if (channel.guildId) {
      void events.emit("channel.delete", channel);
    }
  });

  client.on("roleDelete", (role) => {
    void events.emit("role.delete", role);
  });
}

async function emitReaction(
  events: PlatformEventBus,
  reaction: import("discord.js").MessageReaction | import("discord.js").PartialMessageReaction,
  user: import("discord.js").User | import("discord.js").PartialUser
): Promise<void> {
  const resolvedReaction = reaction.partial
    ? await reaction.fetch().catch(() => null)
    : reaction;
  const resolvedUser = user.partial
    ? await user.fetch().catch(() => null)
    : user;

  if (!resolvedReaction || !resolvedUser) return;

  await events.emit("reaction.add", {
    reaction: resolvedReaction,
    user: resolvedUser
  });
}

async function emitMemberAdd(
  events: PlatformEventBus,
  member: import("discord.js").GuildMember | import("discord.js").PartialGuildMember
): Promise<void> {
  const resolved = member.partial
    ? await member.fetch().catch(() => null)
    : member;
  if (resolved) await events.emit("member.add", resolved);
}

async function emitMemberRemove(
  events: PlatformEventBus,
  member: import("discord.js").GuildMember | import("discord.js").PartialGuildMember
): Promise<void> {
  const resolved = member.partial
    ? await member.fetch().catch(() => null)
    : member;
  if (resolved) await events.emit("member.remove", resolved);
}

async function emitMemberUpdate(
  events: PlatformEventBus,
  oldMember: import("discord.js").GuildMember | import("discord.js").PartialGuildMember,
  newMember: import("discord.js").GuildMember
): Promise<void> {
  const oldResolved = oldMember.partial
    ? await oldMember.fetch().catch(() => null)
    : oldMember;
  if (oldResolved) {
    await events.emit("member.update", {
      oldMember: oldResolved,
      newMember
    });
  }
}

export async function routeCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  db: Database,
  temporaryVoice: TemporaryVoice,
  moderation: Moderation
): Promise<void> {
  try {
    await handleCommand(
      client,
      interaction,
      db,
      temporaryVoice,
      moderation
    );
  } catch (error) {
    logger.error("Command failed", {
      command: interaction.commandName,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      error: String(error)
    });

    const reply = {
      content: "Произошла внутренняя ошибка.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => undefined);
    } else {
      await interaction.reply(reply).catch(() => undefined);
    }
  }
}
