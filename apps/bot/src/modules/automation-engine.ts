import type {
  ChatInputCommandInteraction,
  GuildMember,
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
import { assertSafeFeedUrl } from "./notifications.js";

type RuntimeEvent = {
  type: AutomationEvent;
  guildId: string;
  userId?: string;
  channelId?: string;
  content?: string;
  messageId?: string;
  numeric?: Record<string, number>;
};

const SUPPORTED_EVENTS: AutomationEvent[] = [
  "member.join","member.leave","member.role.add","member.role.remove",
  "message.create","message.delete","message.edit","reaction.add",
  "voice.join","voice.leave","voice.move","moderation.case",
  "ticket.create","ticket.close","giveaway.end","schedule"
];

export type AutomationRuleRecord = AutomationRule & {
  cooldownSeconds: number;
};

export class AutomationEngine implements PlatformModule {
  readonly name = "automation";
  private unsubscribe?: () => void;
  private readonly rules = new Map<string, AutomationRule[]>();
  private client?: import("discord.js").Client;
  private readonly cooldowns = new Map<string, number>();
  private readonly keyedCooldowns = new Map<string, number>();
  private readonly templates = new Map<string, Map<string, string>>();
  private scheduleTimer?: NodeJS.Timeout;
  private delayedTimer?: NodeJS.Timeout;
  private identityId = "primary";
  private executionCounter = 0;
  private lastScheduleMinute: number | null = null;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.identityId = context.identityId;
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
          userId: member.id,
          numeric: { memberCount: member.guild.memberCount }
        })
      ),
      context.events.on("member.update", ({ oldMember, newMember }) => this.executeMemberRoleDiff(oldMember, newMember)),
      context.events.on("message.create", (message) => this.executeFromMessage(message)),
      context.events.on("message.delete", (message) => {
        if (!message.guildId) return;
        return this.execute({
          type: "message.delete", guildId: message.guildId, userId: message.author.id,
          channelId: message.channelId, content: message.content, messageId: message.id,
          numeric: { messageLength: message.content.length }
        });
      }),
      context.events.on("message.update", ({ oldMessage, newMessage }) => {
        if (!newMessage.guildId) return;
        return this.execute({
          type: "message.edit", guildId: newMessage.guildId, userId: newMessage.author.id,
          channelId: newMessage.channelId, content: newMessage.content, messageId: newMessage.id,
          numeric: { messageLength: newMessage.content.length, previousLength: oldMessage.content.length }
        });
      }),
      context.events.on("reaction.add", ({ reaction, user }) => {
        if (!reaction.message.guildId) return;
        return this.execute({
          type: "reaction.add", guildId: reaction.message.guildId, userId: user.id,
          channelId: reaction.message.channelId, messageId: reaction.message.id
        });
      }),
      context.events.on("voice.state", ({ oldState, newState }) => this.executeFromVoice(oldState, newState)),
      context.events.on("moderation.case", (event) => this.execute({ type: "moderation.case", ...event })),
      context.events.on("ticket.create", (event) => this.execute({ type: "ticket.create", ...event })),
      context.events.on("ticket.close", (event) => this.execute({ type: "ticket.close", ...event })),
      context.events.on("giveaway.end", (event) => this.execute({
        type: "giveaway.end", guildId: event.guildId,
        numeric: { giveawayId: event.giveawayId, winnerCount: event.winners.length },
        content: event.winners.join(",")
      }))
    ];

    this.scheduleTimer = setInterval(() => void this.emitSchedules(), 15_000);
    this.scheduleTimer.unref();
    this.delayedTimer = setInterval(() => void this.processDelayedJobs(), 5_000);
    this.delayedTimer.unref();

    this.unsubscribe = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      if (this.scheduleTimer) clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
      if (this.delayedTimer) clearInterval(this.delayedTimer);
      this.delayedTimer = undefined;
    };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.rules.clear();
    this.cooldowns.clear();
    this.keyedCooldowns.clear();
    this.templates.clear();
    this.executionCounter = 0;
    this.lastScheduleMinute = null;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = undefined;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "automation") return;

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "template") {
      const action = interaction.options.getString("action", true);
      if (action === "list") {
        const templates = await this.listTemplates(interaction.guild!.id);
        await interaction.reply({
          content: templates.length
            ? "**Automation templates**\n" + templates.map((item) => "```" + item.name + " → " + item.content + "```").join("\n").slice(0,3900)
            : "Шаблонов пока нет.",
          ephemeral: true
        });
        return;
      }
      const name = interaction.options.getString("name", true);
      if (action === "delete") {
        const deleted = await this.deleteTemplate(interaction.guild!.id, name);
        await interaction.reply({
          content: deleted ? "Шаблон **" + name.trim().toLowerCase() + "** удалён." : "Такого шаблона нет.",
          ephemeral: true
        });
        return;
      }
      const content = interaction.options.getString("content", true);
      await this.setTemplate(interaction.guild!.id, name, content);
      await interaction.reply({ content: "✅ Шаблон **" + name.trim().toLowerCase() + "** сохранён.", ephemeral: true });
      return;
    }

    if (subcommand !== "create") return;

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
      any_conditions: AutomationCondition[];
      actions: AutomationAction[];
      cooldown_seconds: number;
    }>(
      "SELECT id,guild_id,name,enabled,event,conditions,any_conditions,actions,cooldown_seconds FROM automation_rules WHERE guild_id=$1 ORDER BY id DESC",
      [guildId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      enabled: row.enabled,
      all: row.conditions ?? [],
      any: row.any_conditions ?? [],
      event: row.event,
      actions: row.actions ?? [],
      cooldownSeconds: row.cooldown_seconds
    }));
  }

  async updateRule(
    guildId: string,
    ruleId: string,
    input: { name: string; event: AutomationEvent; conditions: AutomationCondition[]; anyConditions?: AutomationCondition[]; actions: AutomationAction[]; cooldownSeconds: number; enabled?: boolean }
  ): Promise<boolean> {
    const anyConditions = input.anyConditions ?? [];
    validateAutomationRule(input.event, [...input.conditions, ...anyConditions], input.actions);
    const result = await this.db.query(
      `UPDATE automation_rules
       SET name=$1,event=$2,conditions=$3::jsonb,any_conditions=$4::jsonb,actions=$5::jsonb,cooldown_seconds=$6,enabled=$7,updated_at=now()
       WHERE id=$8 AND guild_id=$9`,
      [
        input.name.trim().slice(0,80) || "Automation rule",
        input.event,
        JSON.stringify(input.conditions),
        JSON.stringify(anyConditions),
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
      any_conditions: AutomationCondition[];
      actions: AutomationAction[];
      cooldown_seconds: number;
    }>(
      `SELECT ar.id,ar.guild_id,ar.name,ar.enabled,ar.event,ar.conditions,ar.any_conditions,ar.actions,ar.cooldown_seconds
       FROM automation_rules ar
       INNER JOIN guild_bot_assignments ga
         ON ga.guild_id=ar.guild_id
       LEFT JOIN bot_heartbeats bh
         ON bh.bot_identity_id=ga.bot_identity_id
       WHERE ar.enabled=true
         AND (
           ga.bot_identity_id=$1
           OR ($1='primary' AND ga.bot_identity_id <> 'primary' AND bh.last_seen_at < now()-interval '90 seconds')
         )`,
      [this.identityId]
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
        any: row.any_conditions ?? [],
        event: row.event,
        actions: row.actions ?? []
      });
      this.rules.set(row.guild_id, list);
    }

    const templateResult = await this.db.query<{ guild_id: string; name: string; content: string }>(
      "SELECT guild_id,name,content FROM automation_templates ORDER BY guild_id,name"
    );
    this.templates.clear();
    for (const row of templateResult.rows) {
      const guildTemplates = this.templates.get(row.guild_id) ?? new Map<string, string>();
      guildTemplates.set(row.name, row.content);
      this.templates.set(row.guild_id, guildTemplates);
    }
  }

  async listTemplates(guildId: string): Promise<Array<{ name: string; content: string }>> {
    const result = await this.db.query<{ name: string; content: string }>(
      "SELECT name,content FROM automation_templates WHERE guild_id=$1 ORDER BY name",
      [guildId]
    );
    return result.rows.map((row) => ({ name: row.name, content: row.content }));
  }

  async setTemplate(guildId: string, name: string, content: string): Promise<void> {
    const normalizedName = normalizeTemplateName(name);
    const normalizedContent = content.trim().slice(0, 2000);
    if (!normalizedName) throw new Error("invalid_automation_template_name");
    if (!normalizedContent) throw new Error("invalid_automation_template_content");
    await this.db.query(
      "INSERT INTO automation_templates(guild_id,name,content) VALUES($1,$2,$3) ON CONFLICT(guild_id,name) DO UPDATE SET content=EXCLUDED.content,updated_at=now()",
      [guildId, normalizedName, normalizedContent]
    );
    const guildTemplates = this.templates.get(guildId) ?? new Map<string, string>();
    guildTemplates.set(normalizedName, normalizedContent);
    this.templates.set(guildId, guildTemplates);
  }

  async deleteTemplate(guildId: string, name: string): Promise<boolean> {
    const normalizedName = normalizeTemplateName(name);
    if (!normalizedName) throw new Error("invalid_automation_template_name");
    const result = await this.db.query(
      "DELETE FROM automation_templates WHERE guild_id=$1 AND name=$2",
      [guildId, normalizedName]
    );
    const guildTemplates = this.templates.get(guildId);
    guildTemplates?.delete(normalizedName);
    return result.rowCount === 1;
  }

  async createRule(
    guildId: string,
    name: string,
    event: AutomationEvent,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
    cooldownSeconds = 0,
    anyConditions: AutomationCondition[] = []
  ): Promise<AutomationRuleRecord> {
    validateAutomationRule(event, [...conditions, ...anyConditions], actions);

    const created = await this.db.query<{ id: string }>(
      `INSERT INTO automation_rules(
         guild_id,name,enabled,event,conditions,any_conditions,actions,cooldown_seconds
       )
       VALUES($1,$2,true,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
       RETURNING id`,
      [
        guildId,
        name.slice(0, 80),
        event,
        JSON.stringify(conditions),
        JSON.stringify(anyConditions),
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
      content: message.content,
      messageId: message.id,
      numeric: {
        messageLength: message.content.length,
        mentionCount: message.mentions.users.size + message.mentions.roles.size
      }
    });
  }

  private async executeMemberRoleDiff(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    const before = new Set(oldMember.roles.cache.keys());
    const after = new Set(newMember.roles.cache.keys());
    for (const roleId of after) {
      if (!before.has(roleId)) {
        await this.execute({ type: "member.role.add", guildId: newMember.guild.id, userId: newMember.id, content: roleId });
      }
    }
    for (const roleId of before) {
      if (!after.has(roleId)) {
        await this.execute({ type: "member.role.remove", guildId: newMember.guild.id, userId: newMember.id, content: roleId });
      }
    }
  }

  private async emitSchedules(): Promise<void> {
    await this.reload();
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    if (this.lastScheduleMinute === minute) return;
    this.lastScheduleMinute = minute;

    for (const guildId of this.rules.keys()) {
      await this.execute({
        type: "schedule",
        guildId,
        content: now.toISOString(),
        numeric: {
          timestamp: now.getTime(),
          minute: now.getMinutes(),
          hour: now.getHours(),
          dayOfWeek: now.getDay(),
          dayOfMonth: now.getDate()
        }
      });
    }
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
      if (!await this.conditionsMatch(rule.all, event)) continue;
      if (rule.any.length > 0 && !await this.conditionsAnyMatch(rule.any, event)) continue;

      const cooldownSeconds = await this.cooldownFor(rule.id);
      this.executionCounter += 1;
      if (this.executionCounter % 100 === 0) this.pruneCooldowns(Date.now());
      const cooldownKey = `${event.guildId}:${rule.id}:${event.userId ?? "global"}`;
      const previous = this.cooldowns.get(cooldownKey) ?? 0;
      if (cooldownSeconds > 0 && Date.now() - previous < cooldownSeconds * 1000) continue;

      this.cooldowns.set(cooldownKey, Date.now());
      for (const condition of rule.all) {
        if (condition.type === "cooldown-clear") {
          this.keyedCooldowns.set(`${event.guildId}:${condition.key}`, Date.now() + cooldownSeconds * 1000);
        }
      }
      await this.perform(rule.actions, event);
    }
  }

  private pruneCooldowns(now: number): void {
    const cutoff = now - 86_400_000;
    for (const [key, timestamp] of this.cooldowns) {
      if (timestamp < cutoff) this.cooldowns.delete(key);
    }
    for (const [key, timestamp] of this.keyedCooldowns) {
      if (timestamp < now) this.keyedCooldowns.delete(key);
    }

    const maxKeys = 10_000;
    if (this.cooldowns.size > maxKeys) {
      const oldest = [...this.cooldowns.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.cooldowns.size - maxKeys);
      for (const [key] of oldest) this.cooldowns.delete(key);
      logger.warn("Automation cooldown cache trimmed", {
        removed: oldest.length,
        remaining: this.cooldowns.size
      });
    }

    if (this.keyedCooldowns.size > maxKeys) {
      const oldest = [...this.keyedCooldowns.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, this.keyedCooldowns.size - maxKeys);
      for (const [key] of oldest) this.keyedCooldowns.delete(key);
      logger.warn("Automation keyed cooldown cache trimmed", {
        removed: oldest.length,
        remaining: this.keyedCooldowns.size
      });
    }
  }

  private async cooldownFor(ruleId: string): Promise<number> {
    const result = await this.db.query<{ cooldown_seconds: number }>(
      "SELECT cooldown_seconds FROM automation_rules WHERE id=$1",
      [ruleId]
    );
    return result.rows[0]?.cooldown_seconds ?? 0;
  }

  private async conditionsAnyMatch(conditions: AutomationCondition[], event: RuntimeEvent): Promise<boolean> {
    for (const condition of conditions) {
      if (await this.conditionsMatch([condition], event)) return true;
    }
    return false;
  }

  private async conditionsMatch(conditions: AutomationCondition[], event: RuntimeEvent): Promise<boolean> {
    for (const condition of conditions) {
      switch (condition.type) {
        case "channel-is":
          if (event.channelId !== condition.channelId) return false;
          break;
        case "contains": {
          const value = resolveTextField(event, condition.left);
          if (value === undefined || !value.toLocaleLowerCase().includes(condition.right.toLocaleLowerCase())) return false;
          break;
        }
        case "equals":
          if (resolveTextField(event, condition.left) !== condition.right) return false;
          break;
        case "matches": {
          const value = resolveTextField(event, condition.left);
          if (value === undefined) return false;
          try {
            if (!new RegExp(condition.pattern, "i").test(value)) return false;
          } catch {
            return false;
          }
          break;
        }
        case "number-gte": {
          const value = event.numeric?.[String(condition.left)];
          if (value === undefined || value < condition.right) return false;
          break;
        }
        case "number-lte": {
          const value = event.numeric?.[String(condition.left)];
          if (value === undefined || value > condition.right) return false;
          break;
        }
        case "has-role": {
          const guild = this.client?.guilds.cache.get(event.guildId);
          const member = event.userId ? await guild?.members.fetch(event.userId).catch(() => null) : null;
          if (!member?.roles.cache.has(condition.roleId)) return false;
          break;
        }
        case "cooldown-clear":
          if (Date.now() < (this.keyedCooldowns.get(event.guildId + ":" + condition.key) ?? 0)) return false;
          break;
      }
    }
    return true;
  }
  private async enqueueDelayedJob(event: RuntimeEvent, actions: AutomationAction[], seconds: number): Promise<void> {
    const safeSeconds = Math.min(Math.max(Math.trunc(seconds), 1), 3600);
    await this.db.query(
      "INSERT INTO automation_delayed_jobs(guild_id,event,actions,available_at) VALUES($1,$2::jsonb,$3::jsonb,now()+make_interval(secs => $4))",
      [event.guildId, JSON.stringify(event), JSON.stringify(actions), safeSeconds]
    );
  }

  private async processDelayedJobs(): Promise<void> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      event: RuntimeEvent;
      actions: AutomationAction[];
    }>(
      `UPDATE automation_delayed_jobs aj
       SET processing_until=now()+interval '2 minutes',
           attempts=aj.attempts+1
       FROM (
         SELECT aj2.id
         FROM automation_delayed_jobs aj2
         INNER JOIN guild_bot_assignments ga ON ga.guild_id=aj2.guild_id
         LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id
         WHERE aj2.completed_at IS NULL
           AND aj2.available_at <= now()
           AND (aj2.processing_until IS NULL OR aj2.processing_until < now())
           AND (
             ga.bot_identity_id=$1
             OR (
               $1='primary'
               AND ga.bot_identity_id <> 'primary'
               AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '90 seconds')
             )
           )
         ORDER BY aj2.available_at
         LIMIT 20
         FOR UPDATE SKIP LOCKED
       ) claimed
       WHERE aj.id=claimed.id
       RETURNING aj.id,aj.guild_id,aj.event,aj.actions`,
      [this.identityId]
    );

    for (const job of result.rows) {
      try {
        if (!job.event || !Array.isArray(job.actions) || job.actions.length === 0) {
          await this.db.query("UPDATE automation_delayed_jobs SET completed_at=now(),processing_until=NULL,last_error='invalid queued job' WHERE id=$1", [job.id]);
          continue;
        }
        await this.perform(job.actions, job.event);
        await this.db.query(
          "UPDATE automation_delayed_jobs SET completed_at=now(),processing_until=NULL,last_error=NULL WHERE id=$1 AND completed_at IS NULL",
          [job.id]
        );
      } catch (error) {
        await this.db.query(
          "UPDATE automation_delayed_jobs SET processing_until=NULL,last_error=$1 WHERE id=$2",
          [String(error).slice(0, 1000), job.id]
        );
        logger.warn("Automation delayed job failed", { jobId: job.id, guildId: job.guild_id, error: String(error) });
      }
    }
  }

  private async renderTemplate(guildId: string, value: string, event: RuntimeEvent): Promise<string> {
    let output = value;
    const guildTemplates = this.templates.get(guildId);
    for (let depth = 0; depth < 2; depth += 1) {
      const before = output;
      output = await renderTemplate(output, event);
      output = output.replace(/\{template:([a-z0-9_-]{1,40})\}/gi, (_match, rawName: string) => {
        return guildTemplates?.get(rawName.toLowerCase()) ?? "{template:" + rawName + "}";
      });
      if (output === before) break;
    }
    return output.slice(0, 2000);
  }

  private async perform(actions: AutomationAction[], event: RuntimeEvent): Promise<void> {
    const client = this.client;

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!;
      try {
        if (action.type === "delay") {
          const remaining = actions.slice(index + 1);
          if (remaining.length > 0) {
            await this.enqueueDelayedJob(event, remaining, action.seconds);
          }
          return;
        }

        if (action.type === "branch") {
          const matched = await this.conditionsMatch([action.condition], event);
          await this.perform(matched ? action.thenActions : action.elseActions, event);
          continue;
        }

        if (action.type === "webhook") {
          await assertSafeFeedUrl(action.url);
          await fetch(action.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: await this.renderTemplate(event.guildId, action.content, event) }),
            signal: AbortSignal.timeout(5000)
          });
          continue;
        }

        if (action.type === "log") {
          await this.db.query(
            "INSERT INTO audit_events(guild_id,source,action,target_type,target_id,metadata) VALUES($1,'system','automation.log','automation',NULL,$2::jsonb)",
            [event.guildId, JSON.stringify({ message: await this.renderTemplate(event.guildId, action.message, event) })]
          );
          continue;
        }

        if (action.type === "send-message") {
          const channel = client?.channels.cache.get(action.channelId);
          if (channel?.isTextBased() && "send" in channel) {
            await channel.send(await this.renderTemplate(event.guildId, action.content, event));
          }
          continue;
        }

        if (action.type === "dm-user") {
          const userId = resolveUserReference(action.userId, event.userId);
          const user = userId ? await client?.users.fetch(userId).catch(() => null) : null;
          if (user) await user.send(await this.renderTemplate(event.guildId, action.content, event));
          continue;
        }

        if (action.type === "add-role" || action.type === "remove-role") {
          const guild = client?.guilds.cache.get(event.guildId);
          const userId = resolveUserReference(action.userId, event.userId);
          const member = userId
            ? await guild?.members.fetch(userId).catch(() => null)
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

        if (action.type === "timeout") {
          const guild = client?.guilds.cache.get(event.guildId);
          const userId = resolveUserReference(action.userId, event.userId);
          const member = userId ? await guild?.members.fetch(userId).catch(() => null) : null;
          if (member?.moderatable) {
            await member.timeout(action.durationSeconds * 1000, await this.renderTemplate(event.guildId, action.reason, event));
          }
          continue;
        }

        if (action.type === "delete-message") {
          const channelId = action.channelId === "@event" ? event.channelId : action.channelId;
          const messageId = action.messageId === "@event" ? event.messageId : action.messageId;
          const channel = channelId ? client?.channels.cache.get(channelId) : undefined;
          if (channel?.isTextBased() && "messages" in channel && messageId) {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            await message?.delete();
          }
          continue;
        }

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

export function validateAutomationRule(
  event: AutomationEvent,
  conditions: AutomationCondition[],
  actions: AutomationAction[]
): void {
  if (!SUPPORTED_EVENTS.includes(event)) throw new Error("unsupported_automation_event");
  if (conditions.length > 10) throw new Error("too_many_conditions");
  if (actions.length === 0 || actions.length > 10) throw new Error("invalid_action_count");

  for (const condition of conditions) {
    switch (condition.type) {
      case "contains":
      case "equals":
        if (condition.left.length > 64 || condition.right.length > 200) throw new Error("automation_condition_too_long");
        break;
      case "matches":
        if (condition.left.length > 64 || condition.pattern.length > 120) throw new Error("automation_pattern_too_long");
        try { new RegExp(condition.pattern); } catch { throw new Error("invalid_automation_pattern"); }
        break;
      case "number-gte":
      case "number-lte":
        if (String(condition.left).length > 64 || !Number.isFinite(condition.right)) throw new Error("invalid_numeric_condition");
        break;
      case "has-role":
        if (!/^\\d{17,20}$/.test(condition.userId) || !/^\\d{17,20}$/.test(condition.roleId)) throw new Error("invalid_role_condition");
        break;
      case "channel-is":
        if (!/^\\d{17,20}$/.test(condition.channelId)) throw new Error("invalid_condition_channel");
        break;
      case "cooldown-clear":
        if (!condition.key || condition.key.length > 100) throw new Error("invalid_cooldown_key");
        break;
    }
  }

  validateAutomationActions(actions, 0);

  function validateAutomationActions(items: AutomationAction[], depth: number): void {
    if (items.length < 1 || items.length > 10) throw new Error("invalid_action_count");
    if (depth > 2) throw new Error("automation_branch_too_deep");

    for (const action of items) {
    switch (action.type) {
      case "send-message":
        if (!/^\\d{17,20}$/.test(action.channelId) || !action.content || action.content.length > 2000) throw new Error("invalid_send_message_action");
        break;
      case "dm-user":
        if (!/^\\d{17,20}$/.test(action.userId) && action.userId !== "@event") throw new Error("invalid_dm_user");
        if (!action.content || action.content.length > 2000) throw new Error("invalid_dm_content");
        break;
      case "add-role":
      case "remove-role":
        if ((!/^\\d{17,20}$/.test(action.userId) && action.userId !== "@event") || !/^\\d{17,20}$/.test(action.roleId)) throw new Error("invalid_role_action");
        break;
      case "timeout":
        if ((!/^\\d{17,20}$/.test(action.userId) && action.userId !== "@event") || !Number.isInteger(action.durationSeconds) || action.durationSeconds < 1 || action.durationSeconds > 2419200 || !action.reason || action.reason.length > 500) {
          throw new Error("invalid_timeout_action");
        }
        break;
      case "delete-message":
        if (action.channelId !== "@event" && !/^\\d{17,20}$/.test(action.channelId)) throw new Error("invalid_delete_channel");
        if (action.messageId !== "@event" && !/^\\d{17,20}$/.test(action.messageId)) throw new Error("invalid_delete_message");
        break;
      case "log":
        if (!action.message || action.message.length > 1000) throw new Error("invalid_log_action");
        break;
      case "delay":
        if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 3600) throw new Error("invalid_delay_action");
        break;
      case "webhook":
        if (!/^https:\/\/[^\s<>]+$/i.test(action.url) || action.url.length > 2000) {
          throw new Error("invalid_webhook_url");
        }
        if (!action.content || action.content.length > 2000) throw new Error("invalid_webhook_content");
        break;
      case "branch":
        validateAutomationCondition(action.condition);
        validateAutomationActions(action.thenActions, depth + 1);
        if (action.elseActions.length > 0) validateAutomationActions(action.elseActions, depth + 1);
        break;
    }
  }
  }

  function validateAutomationCondition(condition: AutomationCondition): void {
    switch (condition.type) {
      case "contains":
      case "equals":
        if (condition.left.length > 64 || condition.right.length > 200) throw new Error("automation_condition_too_long");
        break;
      case "matches":
        if (condition.left.length > 64 || condition.pattern.length > 120) throw new Error("automation_pattern_too_long");
        try { new RegExp(condition.pattern); } catch { throw new Error("invalid_automation_pattern"); }
        break;
      case "number-gte":
      case "number-lte":
        if (String(condition.left).length > 64 || !Number.isFinite(condition.right)) throw new Error("invalid_numeric_condition");
        break;
      case "has-role":
        if (!/^\\d{17,20}$/.test(condition.userId) || !/^\\d{17,20}$/.test(condition.roleId)) throw new Error("invalid_role_condition");
        break;
      case "channel-is":
        if (!/^\\d{17,20}$/.test(condition.channelId)) throw new Error("invalid_condition_channel");
        break;
      case "cooldown-clear":
        if (!condition.key || condition.key.length > 100) throw new Error("invalid_cooldown_key");
        break;
    }
  }
}


function resolveTextField(event: RuntimeEvent, field: string): string | undefined {
  if (field === "content") return event.content;
  if (field === "userId") return event.userId;
  if (field === "channelId") return event.channelId;
  if (field === "messageId") return event.messageId;
  if (field === "guildId") return event.guildId;
  return undefined;
}

function resolveUserReference(value: string, eventUserId?: string): string | undefined {
  return value === "@event" ? eventUserId : value;
}

async function renderTemplate(value: string, event: RuntimeEvent): Promise<string> {
  return value
    .replaceAll("{user}", event.userId ? "<@" + event.userId + ">" : "{user}")
    .replaceAll("{userId}", event.userId ?? "{userId}")
    .replaceAll("{channel}", event.channelId ? "<#" + event.channelId + ">" : "{channel}")
    .replaceAll("{channelId}", event.channelId ?? "{channelId}")
    .replaceAll("{messageId}", event.messageId ?? "{messageId}")
    .replaceAll("{content}", event.content ?? "{content}")
    .replaceAll("{guildId}", event.guildId)
    .replaceAll("{event}", event.type)
    .replaceAll("{timestamp}", event.numeric?.timestamp ? new Date(event.numeric.timestamp).toISOString() : new Date().toISOString());
}


export function shouldEmitSchedule(minute: number, lastMinute: number | null): boolean {
  return lastMinute !== minute;
}


function normalizeTemplateName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(name) ? name : "";
}
