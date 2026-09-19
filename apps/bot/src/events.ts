import type {
  ChatInputCommandInteraction,
  GuildMember,
  Interaction,
  Message,
  MessageReaction,
  User,
  VoiceState
} from "discord.js";

export type PlatformEventMap = {
  interaction: Interaction;
  "interaction.command": ChatInputCommandInteraction;
  "voice.state": { oldState: VoiceState; newState: VoiceState };
  "message.create": Message;
  "message.delete": Message;
  "message.update": { oldMessage: Message; newMessage: Message };
  "reaction.add": { reaction: MessageReaction; user: User };
  "member.add": GuildMember;
  "member.remove": GuildMember;
  "member.update": { oldMember: GuildMember; newMember: GuildMember };
  "channel.delete": import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel;
  "role.delete": import("discord.js").Role;
};

type Listener<K extends keyof PlatformEventMap> = (
  payload: PlatformEventMap[K]
) => void | Promise<void>;

export class PlatformEventBus {
  private readonly listeners = new Map<keyof PlatformEventMap, Set<Listener<any>>>();

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

  async emit<K extends keyof PlatformEventMap>(
    event: K,
    payload: PlatformEventMap[K]
  ): Promise<void> {
    const guildId = extractGuildId(event, payload);
    if (guildId && this.guildFilter && !this.guildFilter(guildId)) return;

    const listeners = [
      ...(this.listeners.get(event) ?? [])
    ] as Listener<K>[];

    const settled = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve(listener(payload)))
    );

    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      if (result?.status === "rejected") {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "ERROR",
            message: "Platform event listener failed",
            event,
            listenerIndex: i,
            error: String(result.reason)
          })
        );
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
  if (event === "reaction.add") {
    return (payload as { reaction: MessageReaction }).reaction.message.guildId;
  }
  if (event === "member.add" || event === "member.remove" || event === "member.update") {
    const member = payload as GuildMember | { newMember: GuildMember };
    return "newMember" in member ? member.newMember.guild.id : member.guild.id;
  }
  if (event === "channel.delete") {
    return (payload as { guildId: string | null }).guildId;
  }
  if (event === "role.delete") {
    return (payload as import("discord.js").Role).guild.id;
  }
  return null;
}
