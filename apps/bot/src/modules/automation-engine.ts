import type {
  ChatInputCommandInteraction,
  Message,
  VoiceState
} from "discord.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationEvent,
  AutomationRule
} from "@dsp/domain";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type RuntimeEvent = {
  type: AutomationEvent;
  guildId: string;
  userId?: string;
  channelId?: string;
  content?: string;
};

export type AutomationRuleRecord = AutomationRule & {
  cooldownSeconds: number;
};

export class AutomationEngine implements PlatformModule {
  readonly name = "automation";
  private unsubscribe?: () => void;
  private readonly rules = new Map<string, AutomationRule[]>();
  private client?: import("discord.js").Client;
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    await this.reload();

    const unsubs = [
      context.events.on("interaction.command", (interaction) => this.onCommand(interaction)),
      context.events.on("member.add", (member) =>
        this.execute({
          type: "member.join",
          guildId: member.guild.id,
          userId: member.id
        })
      ),
      context.events.on("member.remove", (member) =>
        this.execute({
          type: "member.leave",
          guildId: member.guild.id,
          userId: member.id
        })
      ),
      context.events.on("message.create", (message) => this.executeFromMessage(message)),
      context.events.on("voice.state", ({ oldState, newState }) =>
        this.executeFromVoice(oldState, newState)
      )
    ];

    this.unsubscribe = () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.rules.clear();
    this.cooldowns.clear();
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
    const responseChannelOption = interaction.options.getChannel("response-channel", true);
    const responseChannel = interaction.guild!.channels.cache.get(responseChannelOption.id);
    if (!responseChannel || responseChannel.type !== 0) {
      await interaction.reply({ content: "Response channel должен быть текстовым.", ephemeral: true });
      return;
    }

    const conditions: AutomationCondition[] = [];
    const eventChannel = interaction.options.getChannel("channel");
    const match = interaction.options.getString("match");
    if (eventChannel) conditions.push({ type: "channel-is", channelId: eventChannel.id });
    if (match) conditions.push({ type: "contains", left: "content", right: match });

    await this.createRule(
      interaction.guild!.id,
      interaction.options.getString("name", true),
      event,
      conditions,
      [
        {
          type: "send-message",
          channelId: responseChannel.id,
          content: interaction.options.getString("response", true)
        }
      ]
    );

    await interaction.reply({ content: "Automation rule создано.", ephemeral: true });
  }

  async listRules(guildId: string): Promise<AutomationRuleRecord[]> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      name: string;
      enabled: boolean;
      event: AutomationEvent;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
      cooldown_seconds: number;
    }>(
      "SELECT id,guild_id,name,enabled,event,conditions,actions,cooldown_seconds FROM automation_rules WHERE guild_id=$1 ORDER BY id DESC",
      [guildId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      enabled: row.enabled,
      all: row.conditions ?? [],
      any: [],
      event: row.event,
      actions: row.actions ?? [],
      cooldownSeconds: row.cooldown_seconds
    }));
  }

  async updateRule(
    guildId: string,
    ruleId: string,
    input: { name: string; event: AutomationEvent; conditions: AutomationCondition[]; actions: AutomationAction[]; cooldownSeconds: number; enabled?: boolean }
  ): Promise<boolean> {
    validateAutomationRule(input.event, input.conditions, input.actions);
    const result = await this.db.query(
      `UPDATE automation_rules
       SET name=$1,event=$2,conditions=$3::jsonb,actions=$4::jsonb,cooldown_seconds=$5,enabled=$6,updated_at=now()
       WHERE id=$7 AND guild_id=$8`,
      [
        input.name.trim().slice(0,80) || "Automation rule",
        input.event,
        JSON.stringify(input.conditions),
        JSON.stringify(input.actions),
        Math.min(Math.max(Math.trunc(input.cooldownSeconds),0),86400),
        input.enabled !== false,
        ruleId,
        guildId
      ]
    );
    if (result.rowCount !== 1) return false;
    await this.reload();
    return true;
  }

  async deleteRule(guildId: string, ruleId: string): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM automation_rules WHERE id=$1 AND guild_id=$2",
      [ruleId,guildId]
    );
    if (result.rowCount !== 1) return false;
    await this.reload();
    return true;
  }

  async reload(): Promise<void> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      name: string;
      enabled: boolean;
      event: AutomationEvent;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
      cooldown_seconds: number;
    }>(
      "SELECT id,guild_id,name,enabled,event,conditions,actions,cooldown_seconds FROM automation_rules WHERE enabled=true"
    );

    this.rules.clear();

    for (const row of result.rows) {
      const list = this.rules.get(row.guild_id) ?? [];
      list.push({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        enabled: row.enabled,
        all: row.conditions ?? [],
        any: [],
        event: row.event,
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
    actions: AutomationAction[],
    cooldownSeconds = 0
  ): Promise<AutomationRuleRecord> {
    validateAutomationRule(event, conditions, actions);

    const created = await this.db.query<{ id: string }>(
      `INSERT INTO automation_rules(
         guild_id,name,enabled,event,conditions,actions,cooldown_seconds
       )
       VALUES($1,$2,true,$3,$4::jsonb,$5::jsonb,$6)
       RETURNING id`,
      [
        guildId,
        name.slice(0, 80),
        event,
        JSON.stringify(conditions),
        JSON.stringify(actions),
        Math.min(Math.max(cooldownSeconds, 0), 86_400)
      ]
    );

    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'automation',true)
       ON CONFLICT(guild_id,module_key)
       DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );

    await this.reload();
    const createdId = created.rows[0]?.id;
    const rule = createdId
      ? (await this.listRules(guildId)).find((item) => item.id === createdId)
      : undefined;
    if (!rule) throw new Error("automation_rule_create_failed");
    return rule;
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

  private async executeFromVoice(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (newState.channelId && !oldState.channelId) {
      await this.execute({
        type: "voice.join",
        guildId: newState.guild.id,
        userId: newState.id,
        channelId: newState.channelId
      });
    } else if (!newState.channelId && oldState.channelId) {
      await this.execute({
        type: "voice.leave",
        guildId: newState.guild.id,
        userId: newState.id,
        channelId: oldState.channelId
      });
    } else if (newState.channelId !== oldState.channelId) {
      await this.execute({
        type: "voice.move",
        guildId: newState.guild.id,
        userId: newState.id,
        channelId: newState.channelId ?? undefined
      });
    }
  }

  private async execute(event: RuntimeEvent): Promise<void> {
    if (!await moduleEnabled(this.db, event.guildId, "automation", false)) return;

    const rules = this.rules.get(event.guildId) ?? [];

    for (const rule of rules) {
      if (rule.event !== event.type) continue;
      if (!this.conditionsMatch(rule.all, event)) continue;

      const cooldownSeconds = await this.cooldownFor(rule.id);
      const cooldownKey = `${event.guildId}:${rule.id}:${event.userId ?? "global"}`;
      const previous = this.cooldowns.get(cooldownKey) ?? 0;
      if (cooldownSeconds > 0 && Date.now() - previous < cooldownSeconds * 1000) continue;

      this.cooldowns.set(cooldownKey, Date.now());
      await this.perform(rule.actions, event);
    }
  }

  private async cooldownFor(ruleId: string): Promise<number> {
    const result = await this.db.query<{ cooldown_seconds: number }>(
      "SELECT cooldown_seconds FROM automation_rules WHERE id=$1",
      [ruleId]
    );
    return result.rows[0]?.cooldown_seconds ?? 0;
  }

  private conditionsMatch(
    conditions: AutomationCondition[],
    event: RuntimeEvent
  ): boolean {
    return conditions.every((condition) => {
      switch (condition.type) {
        case "channel-is":
          return event.channelId === condition.channelId;
        case "contains":
          return (
            typeof event.content === "string" &&
            event.content.toLocaleLowerCase().includes(condition.right.toLocaleLowerCase())
          );
        case "equals":
          return event.content === condition.right;
        case "number-gte":
        case "number-lte":
        case "has-role":
        case "matches":
        case "cooldown-clear":
          return false;
        default:
          return false;
      }
    });
  }

  private async perform(actions: AutomationAction[], event: RuntimeEvent): Promise<void> {
    const client = this.client;

    for (const action of actions) {
      try {
        if (action.type === "log") {
          await this.db.query(
            "INSERT INTO audit_events(guild_id,source,action,target_type,target_id,metadata) VALUES($1,'system','automation.log','automation',NULL,$2::jsonb)",
            [event.guildId, JSON.stringify({ message: action.message })]
          );
          continue;
        }

        if (action.type === "send-message") {
          const channel = client?.channels.cache.get(action.channelId);
          if (channel?.isTextBased() && "send" in channel) {
            await channel.send(action.content);
          }
          continue;
        }

        if (action.type === "add-role" || action.type === "remove-role") {
          const guild = client?.guilds.cache.get(event.guildId);
          const member = event.userId
            ? await guild?.members.fetch(event.userId).catch(() => null)
            : null;
          const role = guild?.roles.cache.get(action.roleId);

          if (
            member &&
            role &&
            member.manageable &&
            guild?.members.me &&
            role.position < guild.members.me.roles.highest.position
          ) {
            if (action.type === "add-role") await member.roles.add(role);
            else await member.roles.remove(role);
          }
          continue;
        }

        if (action.type === "delete-message") {
          const channel = client?.channels.cache.get(action.channelId);
          if (channel?.isTextBased() && "messages" in channel) {
            const message = await channel.messages.fetch(action.messageId).catch(() => null);
            await message?.delete();
          }
          continue;
        }

        logger.warn("Unsupported automation action skipped", {
          guildId: event.guildId,
          action: action.type
        });
      } catch (error) {
        logger.warn("Automation action failed", {
          guildId: event.guildId,
          action: action.type,
          error: String(error)
        });
      }
    }
  }
}

function validateAutomationRule(
  event: AutomationEvent,
  conditions: AutomationCondition[],
  actions: AutomationAction[]
): void {
  const allowedEvents: AutomationEvent[] = [
    "member.join",
    "member.leave",
    "message.create",
    "voice.join",
    "voice.leave",
    "voice.move"
  ];
  if (!allowedEvents.includes(event)) throw new Error("unsupported_automation_event");
  if (conditions.length > 10) throw new Error("too_many_conditions");
  if (actions.length === 0 || actions.length > 10) throw new Error("invalid_action_count");

  for (const condition of conditions) {
    if (
      condition.type === "contains" &&
      condition.right.length > 200
    ) throw new Error("automation_condition_too_long");
  }
}
