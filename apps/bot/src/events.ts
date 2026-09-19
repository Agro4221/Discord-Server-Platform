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
};

type Listener<K extends keyof PlatformEventMap> = (
  payload: PlatformEventMap[K]
) => void | Promise<void>;

export class PlatformEventBus {
  private readonly listeners = new Map<keyof PlatformEventMap, Set<Listener<any>>>();

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
