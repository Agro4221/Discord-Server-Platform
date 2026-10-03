import {
  ChannelType,
  PermissionFlagsBits
} from "discord.js";
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
import type { Moderation } from "./moderation.js";
import type { Tickets } from "./tickets.js";
import type { Giveaways } from "./giveaways.js";
import type { Notifications } from "./notifications.js";
import type { Music } from "./music.js";

type RuntimeEvent = {
  type: AutomationEvent;
  guildId: string;
  userId?: string;
  moderatorUserId?: string;
  channelId?: string;
  roleId?: string;
  action?: string;
  reason?: string;
  content?: string;
  messageId?: string;
  userIsBot?: boolean;
  channelType?: import("@dsp/domain").AutomationChannelType;
  permissions?: import("@dsp/domain").AutomationPermission[];
  numeric?: Record<string, number>;
  roleIds?: string[];
};

const SUPPORTED_EVENTS: AutomationEvent[] = [
  "member.join","member.leave","member.role.add","member.role.remove",
  "message.create","message.delete","message.edit","reaction.add","reaction.remove",
  "channel.delete","role.delete","member.ban",
  "voice.join","voice.leave","voice.move","moderation.case",
  "ticket.create","ticket.close","giveaway.end","schedule"
];

export type AutomationRuleRecord = AutomationRule & {
  cooldownSeconds: number;
};

const AUTOMATION_MAX_ATTEMPTS = 5;
const AUTOMATION_RETRY_BASE_SECONDS = 5;
const AUTOMATION_RETRY_MAX_SECONDS = 300;

export function automationRetryDelaySeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.trunc(attempts));
  return Math.min(
    AUTOMATION_RETRY_MAX_SECONDS,
    AUTOMATION_RETRY_BASE_SECONDS * 2 ** Math.max(0, safeAttempts - 1)
  );
}

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

  constructor(
    private readonly db: Database,
    private readonly moderation: Moderation,
    private readonly integrations: {
      tickets?: Tickets;
      giveaways?: Giveaways;
      notifications?: Notifications;
      music?: Music;
    } = {}
  ) {}

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
          userId: member.id,
          userIsBot: member.user.bot
        })
      ),
      context.events.on("member.remove", (member) =>
        this.execute({
          type: "member.leave",
          guildId: member.guild.id,
          userId: member.id,
          userIsBot: member.user.bot,
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
          userIsBot: newMessage.author.bot,
          channelId: newMessage.channelId, channelType: channelTypeName(newMessage.channel.type),
          content: newMessage.content, messageId: newMessage.id,
          numeric: { messageLength: newMessage.content.length, previousLength: oldMessage.content.length }
        });
      }),
      context.events.on("reaction.add", ({ reaction, user }) => {
        if (!reaction.message.guildId) return;
        return this.execute({
          type: "reaction.add", guildId: reaction.message.guildId, userId: user.id,
          userIsBot: user.bot,
          channelId: reaction.message.channelId, channelType: channelTypeName(reaction.message.channel?.type),
          messageId: reaction.message.id,
          content: reaction.emoji.name ?? reaction.emoji.identifier
        });
      }),
      context.events.on("reaction.remove", ({ reaction, user }) => {
        if (!reaction.message.guildId) return;
        return this.execute({
          type: "reaction.remove", guildId: reaction.message.guildId, userId: user.id,
          userIsBot: user.bot,
          channelId: reaction.message.channelId, channelType: channelTypeName(reaction.message.channel?.type),
          messageId: reaction.message.id,
          content: reaction.emoji.name ?? reaction.emoji.identifier
        });
      }),
      context.events.on("channel.delete", (channel) => {
        if (!channel.guildId) return;
        return this.execute({
          type: "channel.delete",
          guildId: channel.guildId,
          channelId: channel.id,
          channelType: channelTypeName(channel.type),
          content: "name" in channel && typeof channel.name === "string" ? channel.name : undefined
        });
      }),
      context.events.on("role.delete", (role) => this.execute({
        type: "role.delete",
        guildId: role.guild.id,
        roleId: role.id,
        content: role.name
      })),
      context.events.on("member.ban", (event) => this.execute({
        type: "member.ban",
        guildId: event.guildId,
        userId: event.userId
      })),
      context.events.on("voice.state", ({ oldState, newState }) => this.executeFromVoice(oldState, newState)),
      context.events.on("moderation.case", (event) => this.execute({
        type: "moderation.case",
        guildId: event.guildId,
        userId: event.userId,
        moderatorUserId: event.moderatorUserId,
        action: event.action,
        reason: event.reason,
        numeric: { caseId: event.caseId }
      })),
      context.events.on("ticket.create", (event) => this.execute({
        type: "ticket.create", guildId: event.guildId, userId: event.userId, channelId: event.channelId,
        numeric: { ticketId: event.ticketId }
      })),
      context.events.on("ticket.close", (event) => this.execute({
        type: "ticket.close", guildId: event.guildId, userId: event.userId, channelId: event.channelId,
        numeric: { ticketId: event.ticketId }
      })),
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

  async dryRun(input: {
    guildId: string;
    event: AutomationEvent;
    conditions: AutomationCondition[];
    anyConditions: AutomationCondition[];
    actions: AutomationAction[];
    content?: string;
    userId?: string;
    channelId?: string;
    roleIds?: string[];
    userIsBot?: boolean;
    channelType?: import("@dsp/domain").AutomationChannelType;
    permissions?: import("@dsp/domain").AutomationPermission[];
    numeric?: Record<string, number>;
  }): Promise<{
    matched: boolean;
    event: AutomationEvent;
    renderedActions: Array<{ type: string; preview: string }>;
  }> {
    validateAutomationRule(input.event, [...input.conditions, ...input.anyConditions], input.actions);

    const event: RuntimeEvent = {
      type: input.event,
      guildId: input.guildId,
      content: input.content?.slice(0, 2000),
      userId: input.userId,
      userIsBot: input.userIsBot,
      channelId: input.channelId,
      channelType: input.channelType,
      permissions: Array.isArray(input.permissions) ? input.permissions.slice(0, 20) : [],
      roleIds: Array.isArray(input.roleIds) ? input.roleIds.slice(0, 20) : [],
      numeric: Object.fromEntries(
        Object.entries(input.numeric ?? {})
          .filter(([, value]) => Number.isFinite(value))
          .slice(0, 20)
      )
    };

    const allMatched = await this.conditionsMatch(input.conditions, event);
    const anyMatched = input.anyConditions.length === 0 || await this.conditionsAnyMatch(input.anyConditions, event);
    const matched = allMatched && anyMatched;

    return {
      matched,
      event: input.event,
      renderedActions: matched ? await this.previewActions(input.actions, event) : []
    };
  }

  private async previewActions(actions: AutomationAction[], event: RuntimeEvent): Promise<Array<{ type: string; preview: string }>> {
    const output: Array<{ type: string; preview: string }> = [];
    for (const action of actions) {
      switch (action.type) {
        case "send-message":
          output.push({ type: action.type, preview: "send-message → #" + action.channelId + ": " + await this.renderTemplate(event.guildId, action.content, event) });
          break;
        case "dm-user":
          output.push({ type: action.type, preview: "dm-user → " + action.userId + ": " + await this.renderTemplate(event.guildId, action.content, event) });
          break;
        case "add-role":
        case "remove-role":
          output.push({ type: action.type, preview: action.type + " → user " + action.userId + ", role " + action.roleId });
          break;
        case "timeout":
          output.push({ type: action.type, preview: "timeout → " + action.userId + " for " + action.durationSeconds + "s: " + await this.renderTemplate(event.guildId, action.reason, event) });
          break;
        case "warn":
        case "kick":
        case "ban":
          output.push({ type: action.type, preview: action.type + " → " + action.userId + (action.type === "ban" && action.durationMinutes ? " for " + action.durationMinutes + "m" : "") + ": " + await this.renderTemplate(event.guildId, action.reason, event) });
          break;
        case "delete-message":
          output.push({ type: action.type, preview: "delete-message → " + action.channelId + "/" + action.messageId });
          break;
        case "set-nickname":
          output.push({
            type: action.type,
            preview: "set-nickname → " + action.userId + ": " +
              (action.nickname === null ? "(reset)" : await this.renderTemplate(event.guildId, action.nickname, event))
          });
          break;
        case "react-message":
          output.push({ type: action.type, preview: "react-message → " + action.channelId + "/" + action.messageId + " with " + action.emoji });
          break;
        case "ticket-close":
          output.push({ type: action.type, preview: "ticket-close → #" + action.ticketId });
          break;
        case "giveaway-end":
          output.push({ type: action.type, preview: "giveaway-end → #" + action.giveawayId });
          break;
        case "giveaway-reroll":
          output.push({ type: action.type, preview: "giveaway-reroll → #" + action.giveawayId });
          break;
        case "notification-feed-toggle":
          output.push({ type: action.type, preview: "notification-feed-toggle → #" + action.feedId + " = " + (action.enabled ? "enabled" : "disabled") });
          break;
        case "music-control":
          output.push({ type: action.type, preview: "music-control → " + action.action + (action.mode ? " (" + action.mode + ")" : action.value !== undefined ? " (" + action.value + ")" : "") });
          break;
        case "log":
          output.push({ type: action.type, preview: "log → " + await this.renderTemplate(event.guildId, action.message, event) });
          break;
        case "delay":
          output.push({ type: action.type, preview: "delay → " + action.seconds + "s, remaining actions would queue" });
          break;
        case "webhook":
          output.push({ type: action.type, preview: "webhook → " + action.url + " with payload: " + await this.renderTemplate(event.guildId, action.content, event) });
          break;
        case "branch": {
          const branchMatched = await this.conditionsMatch([action.condition], event);
          const branch = await this.previewActions(branchMatched ? action.thenActions : action.elseActions, event);
          output.push({ type: action.type, preview: (branchMatched ? "if matched" : "else") + "; " + (branch.map((item) => item.preview).join(" | ") || "no actions") });
          break;
        }
      }
    }
    return output;
  }

  async diagnostics(guildId: string): Promise<{
    guildId: string;
    rules: { total: number; enabled: number; byEvent: Record<string, number> };
    templates: { total: number };
    delayedJobs: {
      pending: number;
      processing: number;
      withErrors: number;
      deadLettered: number;
      completed24h: number;
      oldestPendingAt: string | null;
      recent: Array<{
        id: string;
        status: "pending" | "processing" | "completed" | "dead-lettered";
        ruleId: string | null;
        attempts: number;
        availableAt: string;
        processingUntil: string | null;
        lastError: string | null;
        completedAt: string | null;
        createdAt: string;
      }>;
    };
    runtime: {
      loadedRules: number;
      executionCounter: number;
      cooldownKeys: number;
      keyedCooldownKeys: number;
      lastScheduleMinute: number | null;
    };
  }> {
    const [rules, templates, summary] = await Promise.all([
      this.listRules(guildId),
      this.listTemplates(guildId),
      this.db.query<{
        pending: string;
        processing: string;
        with_errors: string;
        dead_lettered: string;
        completed_24h: string;
        oldest_pending_at: string | null;
      }>(
        "SELECT " +
        "COUNT(*) FILTER (WHERE completed_at IS NULL AND dead_lettered_at IS NULL) AS pending, " +
        "COUNT(*) FILTER (WHERE completed_at IS NULL AND dead_lettered_at IS NULL AND processing_until IS NOT NULL AND processing_until >= now()) AS processing, " +
        "COUNT(*) FILTER (WHERE completed_at IS NULL AND dead_lettered_at IS NULL AND last_error IS NOT NULL) AS with_errors, " +
        "COUNT(*) FILTER (WHERE completed_at IS NULL AND dead_lettered_at IS NOT NULL) AS dead_lettered, " +
        "COUNT(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at >= now()-interval '24 hours') AS completed_24h, " +
        "MIN(available_at) FILTER (WHERE completed_at IS NULL AND dead_lettered_at IS NULL) AS oldest_pending_at " +
        "FROM automation_delayed_jobs WHERE guild_id=$1",
        [guildId]
      )
    ]);

    const recentResult = await this.db.query<{
      id: string;
      rule_id: string | null;
      attempts: string | number;
      available_at: string;
      processing_until: string | null;
      last_error: string | null;
      dead_lettered_at: string | null;
      completed_at: string | null;
      created_at: string;
    }>(
      "SELECT id::text,rule_id,attempts,available_at,processing_until,last_error,dead_lettered_at,completed_at,created_at " +
      "FROM automation_delayed_jobs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 25",
      [guildId]
    );

    const byEvent: Record<string, number> = {};
    let enabled = 0;
    for (const rule of rules) {
      if (rule.enabled) enabled += 1;
      byEvent[rule.event] = (byEvent[rule.event] ?? 0) + 1;
    }

    const row = summary.rows[0];
    const now = Date.now();
    const recent = recentResult.rows.map((job) => {
      const processingUntilMs = job.processing_until ? Date.parse(job.processing_until) : Number.NaN;
      const status: "pending" | "processing" | "completed" | "dead-lettered" = job.dead_lettered_at
        ? "dead-lettered"
        : job.completed_at
          ? "completed"
          : Number.isFinite(processingUntilMs) && processingUntilMs >= now
            ? "processing"
            : "pending";
      return {
        id: job.id,
        status,
        ruleId: job.rule_id,
        attempts: Number(job.attempts) || 0,
        availableAt: job.available_at,
        processingUntil: job.processing_until,
        lastError: job.last_error,
        completedAt: job.completed_at,
        createdAt: job.created_at
      };
    });

    return {
      guildId,
      rules: { total: rules.length, enabled, byEvent },
      templates: { total: templates.length },
      delayedJobs: {
        pending: Number(row?.pending) || 0,
        processing: Number(row?.processing) || 0,
        withErrors: Number(row?.with_errors) || 0,
        deadLettered: Number(row?.dead_lettered) || 0,
        completed24h: Number(row?.completed_24h) || 0,
        oldestPendingAt: row?.oldest_pending_at ?? null,
        recent
      },
      runtime: {
        loadedRules: [...this.rules.values()].reduce((total, items) => total + items.length, 0),
        executionCounter: this.executionCounter,
        cooldownKeys: this.cooldowns.size,
        keyedCooldownKeys: this.keyedCooldowns.size,
        lastScheduleMinute: this.lastScheduleMinute
      }
    };
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

  async listPresets(guildId: string): Promise<Array<{
    name: string;
    event: AutomationEvent;
    conditions: AutomationCondition[];
    anyConditions: AutomationCondition[];
    actions: AutomationAction[];
    cooldownSeconds: number;
    updatedAt: string;
  }>> {
    const result = await this.db.query<{
      name: string;
      event: AutomationEvent;
      conditions: AutomationCondition[];
      any_conditions: AutomationCondition[];
      actions: AutomationAction[];
      cooldown_seconds: number;
      updated_at: string;
    }>(
      "SELECT name,event,conditions,any_conditions,actions,cooldown_seconds,updated_at FROM automation_workflow_presets WHERE guild_id=$1 ORDER BY updated_at DESC,name",
      [guildId]
    );
    return result.rows.map((row) => ({
      name: row.name,
      event: row.event,
      conditions: row.conditions ?? [],
      anyConditions: row.any_conditions ?? [],
      actions: row.actions ?? [],
      cooldownSeconds: Number(row.cooldown_seconds) || 0,
      updatedAt: row.updated_at
    }));
  }

  async savePreset(
    guildId: string,
    name: string,
    event: AutomationEvent,
    conditions: AutomationCondition[],
    anyConditions: AutomationCondition[],
    actions: AutomationAction[],
    cooldownSeconds = 0
  ): Promise<void> {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) throw new Error("invalid_automation_preset_name");
    validateAutomationRule(event, [...conditions, ...anyConditions], actions);

    const safeCooldown = Math.min(Math.max(Math.trunc(cooldownSeconds), 0), 86_400);
    await this.db.query(
      "INSERT INTO automation_workflow_presets(guild_id,name,event,conditions,any_conditions,actions,cooldown_seconds) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7) ON CONFLICT(guild_id,name) DO UPDATE SET event=EXCLUDED.event,conditions=EXCLUDED.conditions,any_conditions=EXCLUDED.any_conditions,actions=EXCLUDED.actions,cooldown_seconds=EXCLUDED.cooldown_seconds,updated_at=now()",
      [
        guildId,
        normalizedName,
        event,
        JSON.stringify(conditions),
        JSON.stringify(anyConditions),
        JSON.stringify(actions),
        safeCooldown
      ]
    );
  }

  async deletePreset(guildId: string, name: string): Promise<boolean> {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) throw new Error("invalid_automation_preset_name");
    const result = await this.db.query(
      "DELETE FROM automation_workflow_presets WHERE guild_id=$1 AND name=$2",
      [guildId, normalizedName]
    );
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
      userIsBot: message.author.bot,
      channelId: message.channelId,
      channelType: channelTypeName(message.channel.type),
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
        await this.execute({ type: "member.role.add", guildId: newMember.guild.id, userId: newMember.id, roleId, content: roleId, userIsBot: newMember.user.bot });
      }
    }
    for (const roleId of before) {
      if (!after.has(roleId)) {
        await this.execute({ type: "member.role.remove", guildId: newMember.guild.id, userId: newMember.id, roleId, content: roleId, userIsBot: newMember.user.bot });
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
        userIsBot: newState.member?.user.bot ?? false,
        channelId: newState.channelId,
        channelType: channelTypeName(newState.channel?.type)
      });
    } else if (!newState.channelId && oldState.channelId) {
      await this.execute({
        type: "voice.leave",
        guildId: newState.guild.id,
        userId: newState.id,
        userIsBot: newState.member?.user.bot ?? false,
        channelId: oldState.channelId,
        channelType: channelTypeName(oldState.channel?.type)
      });
    } else if (newState.channelId !== oldState.channelId) {
      await this.execute({
        type: "voice.move",
        guildId: newState.guild.id,
        userId: newState.id,
        userIsBot: newState.member?.user.bot ?? false,
        channelId: newState.channelId ?? undefined,
        channelType: channelTypeName(newState.channel?.type)
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
      await this.perform(rule.actions, event, { ruleId: rule.id });
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
        case "has-role":
        case "not-has-role": {
          const referencedUserId = resolveUserReference(condition.userId, event.userId);
          let hasRole = event.userId === referencedUserId
            ? Boolean(event.roleIds?.includes(condition.roleId))
            : false;
          if (event.userId !== referencedUserId) {
            const guild = this.client?.guilds.cache.get(event.guildId);
            const member = referencedUserId ? await guild?.members.fetch(referencedUserId).catch(() => null) : null;
            hasRole = Boolean(member?.roles.cache.has(condition.roleId));
          } else if (!event.roleIds) {
            const guild = this.client?.guilds.cache.get(event.guildId);
            const member = referencedUserId ? await guild?.members.fetch(referencedUserId).catch(() => null) : null;
            hasRole = Boolean(member?.roles.cache.has(condition.roleId));
          }
          if (condition.type === "has-role" ? !hasRole : hasRole) return false;
          break;
        }
        case "channel-type-is":
          if (event.channelType !== condition.channelType) return false;
          break;
        case "user-is-bot": {
          const userId = resolveUserReference(condition.userId, event.userId);
          let isBot = event.userId === userId ? event.userIsBot : undefined;
          if (isBot === undefined && userId) {
            const user = await this.client?.users.fetch(userId).catch(() => null);
            isBot = user?.bot;
          }
          if (isBot === undefined || isBot !== condition.value) return false;
          break;
        }
        case "has-permission": {
          const userId = resolveUserReference(condition.userId, event.userId);
          if (event.userId === userId && event.permissions) {
            if (!event.permissions.includes(condition.permission)) return false;
            break;
          }
          const guild = this.client?.guilds.cache.get(event.guildId);
          const member = userId ? await guild?.members.fetch(userId).catch(() => null) : null;
          const permission = PermissionFlagsBits[condition.permission];
          if (!member || permission === undefined || !member.permissions.has(permission)) return false;
          break;
        }
        case "cooldown-clear":
          if (Date.now() < (this.keyedCooldowns.get(event.guildId + ":" + condition.key) ?? 0)) return false;
          break;
      }
    }
    return true;
  }
  private async enqueueDelayedJob(
    event: RuntimeEvent,
    actions: AutomationAction[],
    seconds: number,
    ruleId?: string
  ): Promise<void> {
    const safeSeconds = Math.min(Math.max(Math.trunc(seconds), 1), 3600);
    await this.db.query(
      "INSERT INTO automation_delayed_jobs(guild_id,rule_id,event,actions,available_at) VALUES($1,$2,$3::jsonb,$4::jsonb,now()+make_interval(secs => $5))",
      [event.guildId, ruleId ?? null, JSON.stringify(event), JSON.stringify(actions), safeSeconds]
    );
  }

  private async processDelayedJobs(): Promise<void> {
    await this.db.query(
      "DELETE FROM automation_delayed_jobs WHERE " +
      "(completed_at IS NOT NULL OR dead_lettered_at IS NOT NULL) AND " +
      "COALESCE(completed_at,dead_lettered_at) < now()-interval '7 days'"
    ).catch((error) => logger.warn("Automation delayed job cleanup failed", { error: String(error) }));

    const result = await this.db.query<{
      id: string;
      guild_id: string;
      event: RuntimeEvent;
      rule_id: string | null;
      attempts: number;
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
           AND aj2.dead_lettered_at IS NULL
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
       RETURNING aj.id,aj.guild_id,aj.rule_id,aj.attempts,aj.event,aj.actions`,
      [this.identityId]
    );

    for (const job of result.rows) {
      try {
        if (!job.event || !Array.isArray(job.actions) || job.actions.length === 0) {
          await this.db.query("UPDATE automation_delayed_jobs SET processing_until=NULL,last_error='invalid queued job',dead_lettered_at=now() WHERE id=$1 AND completed_at IS NULL", [job.id]);
          continue;
        }
        await this.perform(job.actions, job.event, { failFast: true, ruleId: job.rule_id ?? undefined });
        await this.db.query(
          "UPDATE automation_delayed_jobs SET completed_at=now(),processing_until=NULL,last_error=NULL WHERE id=$1 AND completed_at IS NULL",
          [job.id]
        );
      } catch (error) {
        const message = String(error).slice(0, 1000);
        const attempts = Number(job.attempts) || 0;
        if (attempts >= AUTOMATION_MAX_ATTEMPTS) {
          await this.db.query(
            "UPDATE automation_delayed_jobs SET processing_until=NULL,last_error=$1,dead_lettered_at=now() WHERE id=$2 AND completed_at IS NULL",
            [message, job.id]
          );
          logger.error("Automation delayed job moved to dead letter", {
            jobId: job.id,
            guildId: job.guild_id,
            ruleId: job.rule_id,
            attempts,
            error: message
          });
        } else {
          const retryDelay = automationRetryDelaySeconds(attempts);
          await this.db.query(
            "UPDATE automation_delayed_jobs SET processing_until=NULL,last_error=$1,available_at=now()+make_interval(secs => $2) WHERE id=$3 AND completed_at IS NULL AND dead_lettered_at IS NULL",
            [message, retryDelay, job.id]
          );
          logger.warn("Automation delayed job scheduled for retry", {
            jobId: job.id,
            guildId: job.guild_id,
            ruleId: job.rule_id,
            attempts,
            retryDelay,
            error: message
          });
        }
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

  private async perform(
    actions: AutomationAction[],
    event: RuntimeEvent,
    options: { failFast?: boolean; ruleId?: string } = {}
  ): Promise<void> {
    const client = this.client;

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!;
      try {
        if (action.type === "delay") {
          const remaining = actions.slice(index + 1);
          if (remaining.length > 0) {
            await this.enqueueDelayedJob(event, remaining, action.seconds, options.ruleId);
          }
          return;
        }

        if (action.type === "branch") {
          const matched = await this.conditionsMatch([action.condition], event);
          await this.perform(matched ? action.thenActions : action.elseActions, event, options);
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

        if (action.type === "warn" || action.type === "kick" || action.type === "ban") {
          const userId = resolveUserReference(action.userId, event.userId);
          if (!userId) continue;
          const reason = await this.renderTemplate(event.guildId, action.reason, event);
          const durationMinutes = action.type === "ban" ? action.durationMinutes : undefined;
          await this.moderation.dashboardAction(
            event.guildId,
            userId,
            action.type,
            reason,
            durationMinutes,
            "automation"
          );
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

        if (action.type === "set-nickname") {
          const guild = client?.guilds.cache.get(event.guildId);
          const userId = resolveUserReference(action.userId, event.userId);
          const member = userId ? await guild?.members.fetch(userId).catch(() => null) : null;
          if (member?.manageable) {
            await member.setNickname(
              action.nickname === null ? null : await this.renderTemplate(event.guildId, action.nickname, event)
            );
          }
          continue;
        }

        if (action.type === "react-message") {
          const channelId = action.channelId === "@event" ? event.channelId : action.channelId;
          const messageId = action.messageId === "@event" ? event.messageId : action.messageId;
          const channel = channelId ? client?.channels.cache.get(channelId) : undefined;
          if (channel?.isTextBased() && "messages" in channel && messageId) {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            await message?.react(action.emoji);
          }
          continue;
        }

        if (action.type === "ticket-close") {
          const ticketId = action.ticketId === "@event" ? Number(event.numeric?.ticketId) : Number(action.ticketId);
          if (!Number.isSafeInteger(ticketId) || ticketId < 1) throw new Error("invalid_ticket_id");
          if (!this.integrations.tickets) throw new Error("tickets_unavailable");
          const closed = await this.integrations.tickets.closeByAutomation(event.guildId, ticketId, event.userId ?? "automation");
          if (!closed) throw new Error("ticket_not_found_or_not_open");
          continue;
        }

        if (action.type === "giveaway-end") {
          if (!this.integrations.giveaways) throw new Error("giveaways_unavailable");
          const giveawayId = Number(action.giveawayId);
          if (!Number.isSafeInteger(giveawayId) || giveawayId < 1) throw new Error("invalid_giveaway_id");
          const ended = await this.integrations.giveaways.endGiveaway(giveawayId, event.guildId);
          if (!ended) throw new Error("giveaway_not_found_or_not_running");
          continue;
        }

        if (action.type === "giveaway-reroll") {
          if (!this.integrations.giveaways) throw new Error("giveaways_unavailable");
          const giveawayId = Number(action.giveawayId);
          if (!Number.isSafeInteger(giveawayId) || giveawayId < 1) throw new Error("invalid_giveaway_id");
          const winners = await this.integrations.giveaways.rerollGiveaway(giveawayId, event.guildId);
          if (winners === null) throw new Error("giveaway_not_found_or_not_finished");
          continue;
        }

        if (action.type === "notification-feed-toggle") {
          if (!this.integrations.notifications) throw new Error("notifications_unavailable");
          const changed = await this.integrations.notifications.setFeedEnabled(event.guildId, action.feedId, action.enabled);
          if (!changed) throw new Error("notification_feed_not_found");
          continue;
        }

        if (action.type === "music-control") {
          if (!this.integrations.music) throw new Error("music_unavailable");
          await this.integrations.music.dashboardControl(event.guildId, action.action, {
            value: action.value,
            mode: action.mode,
            enabled: action.enabled
          });
          continue;
        }

      } catch (error) {
        logger.warn("Automation action failed", {
          guildId: event.guildId,
          action: action.type,
          error: String(error),
          retryable: options.failFast === true
        });
        if (options.failFast) throw error;
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
      case "not-has-role":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") || !/^\d{17,20}$/.test(condition.roleId)) throw new Error("invalid_role_condition");
        break;
      case "channel-is":
        if (!/^\d{17,20}$/.test(condition.channelId)) throw new Error("invalid_condition_channel");
        break;
      case "channel-type-is":
        if (!["text","announcement","forum","voice","stage","category","thread","other"].includes(condition.channelType)) throw new Error("invalid_channel_type_condition");
        break;
      case "user-is-bot":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") || typeof condition.value !== "boolean") throw new Error("invalid_user_bot_condition");
        break;
      case "has-permission":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") ||
            !["Administrator","ManageGuild","ManageChannels","ManageRoles","ManageMessages","KickMembers","BanMembers","ModerateMembers"].includes(condition.permission)) {
          throw new Error("invalid_permission_condition");
        }
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
        if (!/^\d{17,20}$/.test(action.channelId) || !action.content || action.content.length > 2000) throw new Error("invalid_send_message_action");
        break;
      case "dm-user":
        if (!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") throw new Error("invalid_dm_user");
        if (!action.content || action.content.length > 2000) throw new Error("invalid_dm_content");
        break;
      case "add-role":
      case "remove-role":
        if ((!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") || !/^\d{17,20}$/.test(action.roleId)) throw new Error("invalid_role_action");
        break;
      case "timeout":
        if ((!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") || !Number.isInteger(action.durationSeconds) || action.durationSeconds < 1 || action.durationSeconds > 2419200 || !action.reason || action.reason.length > 500) {
          throw new Error("invalid_timeout_action");
        }
        break;
      case "warn":
      case "kick":
        if ((!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") || !action.reason || action.reason.length > 500) {
          throw new Error("invalid_" + action.type + "_action");
        }
        break;
      case "ban":
        if ((!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") ||
            !action.reason || action.reason.length > 500 ||
            (action.durationMinutes !== undefined && (!Number.isInteger(action.durationMinutes) || action.durationMinutes < 1 || action.durationMinutes > 40320))) {
          throw new Error("invalid_ban_action");
        }
        break;
      case "delete-message":
        if (action.channelId !== "@event" && !/^\d{17,20}$/.test(action.channelId)) throw new Error("invalid_delete_channel");
        if (action.messageId !== "@event" && !/^\d{17,20}$/.test(action.messageId)) throw new Error("invalid_delete_message");
        break;
      case "set-nickname":
        if ((!/^\d{17,20}$/.test(action.userId) && action.userId !== "@event") ||
            (action.nickname !== null && (typeof action.nickname !== "string" || action.nickname.length > 32))) {
          throw new Error("invalid_set_nickname_action");
        }
        break;
      case "react-message":
        if ((action.channelId !== "@event" && !/^\d{17,20}$/.test(action.channelId)) ||
            (action.messageId !== "@event" && !/^\d{17,20}$/.test(action.messageId)) ||
            typeof action.emoji !== "string" || !action.emoji.trim() || action.emoji.length > 100) {
          throw new Error("invalid_react_message_action");
        }
        break;
      case "ticket-close":
        if ((!/^\d{1,12}$/.test(action.ticketId) && action.ticketId !== "@event")) throw new Error("invalid_ticket_close_action");
        break;
      case "giveaway-end":
      case "giveaway-reroll":
        if (!Number.isSafeInteger(action.giveawayId) || action.giveawayId < 1) throw new Error("invalid_giveaway_action");
        break;
      case "notification-feed-toggle":
        if (!Number.isSafeInteger(action.feedId) || action.feedId < 1 || typeof action.enabled !== "boolean") throw new Error("invalid_notification_feed_action");
        break;
      case "music-control":
        if (!["pause","resume","skip","stop","shuffle","repeat","seek","volume","autoplay"].includes(action.action)) {
          throw new Error("invalid_music_control_action");
        }
        if (action.action === "repeat" && !["off","track","queue"].includes(action.mode)) throw new Error("invalid_music_repeat_mode");
        if ((action.action === "seek" || action.action === "volume") && (!Number.isInteger(action.value) || action.value < 0 || action.value > 86400)) {
          throw new Error("invalid_music_control_value");
        }
        if (action.action === "volume" && action.value > 200) throw new Error("invalid_music_volume");
        if (action.action === "autoplay" && typeof action.enabled !== "boolean") throw new Error("invalid_music_autoplay_value");
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
      case "not-has-role":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") || !/^\d{17,20}$/.test(condition.roleId)) throw new Error("invalid_role_condition");
        break;
      case "channel-is":
        if (!/^\d{17,20}$/.test(condition.channelId)) throw new Error("invalid_condition_channel");
        break;
      case "channel-type-is":
        if (!["text","announcement","forum","voice","stage","category","thread","other"].includes(condition.channelType)) throw new Error("invalid_channel_type_condition");
        break;
      case "user-is-bot":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") || typeof condition.value !== "boolean") throw new Error("invalid_user_bot_condition");
        break;
      case "has-permission":
        if ((!/^\d{17,20}$/.test(condition.userId) && condition.userId !== "@event") ||
            !["Administrator","ManageGuild","ManageChannels","ManageRoles","ManageMessages","KickMembers","BanMembers","ModerateMembers"].includes(condition.permission)) {
          throw new Error("invalid_permission_condition");
        }
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
  if (field === "moderatorUserId") return event.moderatorUserId;
  if (field === "channelId") return event.channelId;
  if (field === "roleId") return event.roleId;
  if (field === "action") return event.action;
  if (field === "reason") return event.reason;
  if (field === "messageId") return event.messageId;
  if (field === "guildId") return event.guildId;
  if (field === "channelType") return event.channelType;
  return undefined;
}

function channelTypeName(type: ChannelType | number | undefined): import("@dsp/domain").AutomationChannelType | undefined {
  switch (type) {
    case ChannelType.GuildText: return "text";
    case ChannelType.GuildAnnouncement: return "announcement";
    case ChannelType.GuildForum: return "forum";
    case ChannelType.GuildVoice: return "voice";
    case ChannelType.GuildStageVoice: return "stage";
    case ChannelType.GuildCategory: return "category";
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return "thread";
    default:
      return type === undefined ? undefined : "other";
  }
}

function resolveUserReference(value: string, eventUserId?: string): string | undefined {
  return value === "@event" ? eventUserId : value;
}

async function renderTemplate(value: string, event: RuntimeEvent): Promise<string> {
  return value
    .replaceAll("{user}", event.userId ? "<@" + event.userId + ">" : "{user}")
    .replaceAll("{userId}", event.userId ?? "{userId}")
    .replaceAll("{moderatorUserId}", event.moderatorUserId ?? "{moderatorUserId}")
    .replaceAll("{roleId}", event.roleId ?? "{roleId}")
    .replaceAll("{action}", event.action ?? "{action}")
    .replaceAll("{reason}", event.reason ?? "{reason}")
    .replaceAll("{channel}", event.channelId ? "<#" + event.channelId + ">" : "{channel}")
    .replaceAll("{channelId}", event.channelId ?? "{channelId}")
    .replaceAll("{messageId}", event.messageId ?? "{messageId}")
    .replaceAll("{content}", event.content ?? "{content}")
    .replaceAll("{guildId}", event.guildId)
    .replaceAll("{event}", event.type)
    .replaceAll("{caseId}", event.numeric?.caseId !== undefined ? String(event.numeric.caseId) : "{caseId}")
    .replaceAll("{ticketId}", event.numeric?.ticketId !== undefined ? String(event.numeric.ticketId) : "{ticketId}")
    .replaceAll("{giveawayId}", event.numeric?.giveawayId !== undefined ? String(event.numeric.giveawayId) : "{giveawayId}")
    .replaceAll("{winnerCount}", event.numeric?.winnerCount !== undefined ? String(event.numeric.winnerCount) : "{winnerCount}")
    .replaceAll("{timestamp}", event.numeric?.timestamp ? new Date(event.numeric.timestamp).toISOString() : new Date().toISOString());
}


export function shouldEmitSchedule(minute: number, lastMinute: number | null): boolean {
  return lastMinute !== minute;
}


function normalizePresetName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(name) ? name : "";
}

function normalizeTemplateName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(name) ? name : "";
}
