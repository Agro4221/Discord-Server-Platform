import type { ChatInputCommandInteraction, Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import type { AutomationRule, AutomationAction, AutomationEvent, AutomationCondition } from "@dsp/domain";

type RuntimeEvent = {
  type: AutomationEvent;
  guildId: string;
  userId?: string;
  channelId?: string;
  content?: string;
};

export class AutomationEngine implements PlatformModule {
  readonly name = "automation";
  private unsubscribe?: () => void;
  private rules = new Map<string, AutomationRule[]>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    await this.reload();
    const unsubs = [
      context.events.on("interaction.command", (interaction) => this.onCommand(interaction)),
      context.events.on("member.add", (member) => this.execute({ type: "member.join", guildId: member.guild.id, userId: member.id })),
      context.events.on("member.remove", (member) => this.execute({ type: "member.leave", guildId: member.guild.id, userId: member.id })),
      context.events.on("message.create", (message) => this.executeFromMessage(message)),
      context.events.on("voice.state", ({ oldState, newState }) => this.executeFromVoice(oldState, newState))
    ];
    this.unsubscribe = () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.rules.clear();
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "automation") return;
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    if (interaction.options.getSubcommand() !== "create") return;

    const event = interaction.options.getString("event", true) as AutomationEvent;
    const responseChannel = interaction.options.getChannel("response-channel", true);
    if (!responseChannel.isTextBased()) {
      await interaction.reply({ content: "Response channel должен быть текстовым.", ephemeral: true });
      return;
    }

    const conditions: AutomationCondition[] = [];
    const eventChannel = interaction.options.getChannel("channel");
    const match = interaction.options.getString("match");
    if (eventChannel) conditions.push({ type: "channel-is", channelId: eventChannel.id });
    if (match) conditions.push({ type: "contains", left: "content", right: match });

    await this.createRule(
      interaction.guild.id,
      interaction.options.getString("name", true),
      event,
      conditions,
      [{ type: "send-message", channelId: responseChannel.id, content: interaction.options.getString("response", true) }]
    );

    await interaction.reply({ content: "Automation rule создано.", ephemeral: true });
  }

  async reload(): Promise<void>
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      name: string;
      enabled: boolean;
      event: AutomationEvent;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }>(
      "SELECT id,guild_id,name,enabled,event,conditions,actions FROM automation_rules WHERE enabled=true"
    );

    this.rules.clear();
    for (const row of result.rows) {
      const list = this.rules.get(row.guild_id) ?? [];
      list.push({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        enabled: row.enabled,
        event: row.event,
        all: row.conditions ?? [],
        any: [],
        actions: row.actions ?? []
      });
      this.rules.set(row.guild_id, list);
    }
  }

  async createRule(
    guildId: string,
    name: string,
    event: AutomationEvent,
    conditions: AutomationCondition[],
    actions: AutomationAction[]
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO automation_rules(guild_id,name,enabled,event,conditions,actions)
       VALUES($1,$2,true,$3,$4::jsonb,$5::jsonb)`,
      [guildId, name, event, JSON.stringify(conditions), JSON.stringify(actions)]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'automation',true)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );
    await this.reload();
  }

  private async executeFromMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    await this.execute({
      type: "message.create",
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      content: message.content
    });
  }

  private async executeFromVoice(
    oldState: import("discord.js").VoiceState,
    newState: import("discord.js").VoiceState
  ): Promise<void> {
    if (newState.channelId && !oldState.channelId) {
      await this.execute({ type: "voice.join", guildId: newState.guild.id, userId: newState.id, channelId: newState.channelId });
    } else if (!newState.channelId && oldState.channelId) {
      await this.execute({ type: "voice.leave", guildId: newState.guild.id, userId: newState.id, channelId: oldState.channelId });
    } else if (newState.channelId !== oldState.channelId) {
      await this.execute({ type: "voice.move", guildId: newState.guild.id, userId: newState.id, channelId: newState.channelId ?? undefined });
    }
  }

  private async execute(event: RuntimeEvent): Promise<void> {
    if (!await moduleEnabled(this.db, event.guildId, "automation", false)) return;
    const rules = this.rules.get(event.guildId) ?? [];

    for (const rule of rules) {
      if (rule.event !== event.type) continue;
      if (!this.conditionsMatch(rule.all, event)) continue;
      await this.perform(rule.actions, event);
    }
  }

  private conditionsMatch(conditions: AutomationCondition[], event: RuntimeEvent): boolean {
    return conditions.every((condition) => {
      if (condition.type === "channel-is") return event.channelId === condition.channelId;
      if (condition.type === "contains") return event.content?.toLocaleLowerCase().includes(condition.right.toLocaleLowerCase()) ?? false;
      if (condition.type === "equals") return event.content === condition.right;
      return true;
    });
  }

  private async perform(actions: AutomationAction[], event: RuntimeEvent): Promise<void> {
    const client = this.client;
    for (const action of actions) {
      if (action.type === "log") {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level: "INFO", automation: true, guildId: event.guildId, message: action.message }));
        continue;
      }

      if (action.type === "send-message") {
        const channel = client?.channels.cache.get(action.channelId);
        if (channel?.isTextBased() && "send" in channel) {
          await channel.send(action.content).catch(() => undefined);
        }
        continue;
      }

      if (action.type === "add-role") {
        const guild = client?.guilds.cache.get(event.guildId);
        const member = event.userId ? await guild?.members.fetch(event.userId).catch(() => null) : null;
        const role = guild?.roles.cache.get(action.roleId);
        if (member && role && member.manageable && role.position < (guild.members.me?.roles.highest.position ?? 0)) {
          await member.roles.add(role).catch(() => undefined);
        }
      }

      if (action.type === "remove-role") {
        const guild = client?.guilds.cache.get(event.guildId);
        const member = event.userId ? await guild?.members.fetch(event.userId).catch(() => null) : null;
        const role = guild?.roles.cache.get(action.roleId);
        if (member && role && member.manageable && role.position < (guild.members.me?.roles.highest.position ?? 0)) {
          await member.roles.remove(role).catch(() => undefined);
        }
      }

      if (action.type === "delete-message") {
        const channel = client?.channels.cache.get(action.channelId);
        if (channel?.isTextBased() && "messages" in channel) {
          const message = await channel.messages.fetch(action.messageId).catch(() => null);
          await message?.delete().catch(() => undefined);
        }
      }
    }
  }
}

