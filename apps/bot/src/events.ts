import type {
  ChatInputCommandInteraction,
  GuildMember,
  Interaction,
  Message,
  MessageReaction,
  User,
  VoiceState
} from "discord.js";
import { logger } from "./logger.js";

export type CommandGuard = (
  interaction: ChatInputCommandInteraction
) => boolean | Promise<boolean>;

export type PlatformEventMap = {
  interaction: Interaction;
  "interaction.command": ChatInputCommandInteraction;
  "voice.state": { oldState: VoiceState; newState: VoiceState };
  "message.create": Message;
  "message.delete": Message;
  "message.update": { oldMessage: Message; newMessage: Message };
  "reaction.add": { reaction: MessageReaction; user: User };
  "reaction.remove": { reaction: MessageReaction; user: User };
  "member.add": GuildMember;
  "member.remove": GuildMember;
  "member.update": { oldMember: GuildMember; newMember: GuildMember };
  "member.role.add": { guildId: string; userId: string; roleId: string };
  "member.role.remove": { guildId: string; userId: string; roleId: string };
  "moderation.case": { guildId: string; userId: string; action: string; caseId: number; moderatorUserId?: string; reason?: string };
  "ticket.create": { guildId: string; userId: string; ticketId: number; channelId: string };
  "ticket.close": { guildId: string; userId: string; ticketId: number; channelId: string };
  "giveaway.end": { guildId: string; giveawayId: number; winners: string[] };
  "schedule": { guildId: string; timestamp: number };
  "channel.delete": import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel;
  "role.delete": import("discord.js").Role;
  "member.ban": { guildId: string; userId: string };
};

type Listener<K extends keyof PlatformEventMap> = (
  payload: PlatformEventMap[K]
) => void | Promise<void>;

export class PlatformEventBus {
  private readonly listeners = new Map<keyof PlatformEventMap, Set<Listener<any>>>();
  private readonly commandGuards = new Set<CommandGuard>();

  constructor(private readonly guildFilter?: (guildId: string) => boolean) {}

  on<K extends keyof PlatformEventMap>(
    event: K,
    listener: Listener<K>
  ): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener<any>>();
    set.add(listener as Listener<any>);
    this.listeners.set(event, set);

    return () => {
      set.delete(listener as Listener<any>);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  addCommandGuard(guard: CommandGuard): () => void {
    this.commandGuards.add(guard);
    return () => this.commandGuards.delete(guard);
  }

  async emit<K extends keyof PlatformEventMap>(
    event: K,
    payload: PlatformEventMap[K]
  ): Promise<void> {
    const guildId = extractGuildId(event, payload);
    if (guildId && this.guildFilter && !this.guildFilter(guildId)) return;

    if (event === "interaction.command") {
      for (const guard of this.commandGuards) {
        const allowed = await guard(payload as ChatInputCommandInteraction);
        if (!allowed) return;
      }
    }

    const listeners = [
      ...(this.listeners.get(event) ?? [])
    ] as Listener<K>[];

    const settled = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve(listener(payload)))
    );

    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      if (result?.status === "rejected") {
        logger.error("Platform event listener failed", {
          event,
          listenerIndex: i,
          error: String(result.reason)
        });
      }
    }
  }
}

function extractGuildId<K extends keyof PlatformEventMap>(
  event: K,
  payload: PlatformEventMap[K]
): string | null {
  if (event === "interaction" || event === "interaction.command") {
    const interaction = payload as Interaction;
    return interaction.guildId ?? null;
  }
  if (event === "voice.state") {
    return (payload as { newState: VoiceState }).newState.guild.id;
  }
  if (event === "message.create" || event === "message.delete") {
    return (payload as Message).guildId;
  }
  if (event === "message.update") {
    return (payload as { newMessage: Message }).newMessage.guildId;
  }
  if (event === "reaction.add" || event === "reaction.remove") {
    return (payload as { reaction: MessageReaction }).reaction.message.guildId;
  }
  if (event === "member.add" || event === "member.remove" || event === "member.update") {
    const member = payload as GuildMember | { newMember: GuildMember };
    const guild = "newMember" in member ? member.newMember.guild : member.guild;
    return guild?.id ?? null;
  }
  if (event === "member.role.add" || event === "member.role.remove" ||
      event === "moderation.case" || event === "ticket.create" || event === "ticket.close" ||
      event === "giveaway.end" || event === "schedule") {
    return (payload as { guildId: string }).guildId;
  }
  if (event === "channel.delete") {
    return (payload as { guildId: string | null }).guildId;
  }
  if (event === "role.delete") {
    return (payload as import("discord.js").Role).guild.id;
  }
  if (event === "member.ban") {
    return (payload as { guildId: string }).guildId;
  }
  return null;
}
