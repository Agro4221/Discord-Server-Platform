import { type GuildMember, type TextChannel } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled, renderTemplate } from "../module-utils.js";
import { logger } from "../logger.js";

export type OnboardingTrigger = "member.join" | "verification.passed";
export type OnboardingStep =
  | { type: "role"; roleId: string }
  | { type: "channel-message"; channelId: string; content: string }
  | { type: "dm"; content: string };

export type OnboardingFlow = {
  guildId: string;
  enabled: boolean;
  trigger: OnboardingTrigger;
  steps: OnboardingStep[];
};

export class Onboarding implements PlatformModule {
  readonly name = "onboarding";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];
  private auditLog?: ModuleContext["auditLog"];

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;

    const a = context.events.on("member.add", (member) => {
      void this.execute(member.guild.id, member.id, "member.join");
    });
    const b = context.events.on("verification.passed", (event) => {
      void this.execute(event.guildId, event.userId, "verification.passed");
    });
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.auditLog = undefined;
  }

  async get(guildId: string): Promise<OnboardingFlow> {
    const result = await this.db.query<{
      enabled: boolean;
      trigger: OnboardingTrigger;
      steps: unknown;
    }>(
      "SELECT enabled,trigger,steps FROM onboarding_flows WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return { guildId, enabled: false, trigger: "member.join", steps: [] };

    return {
      guildId,
      enabled: Boolean(row.enabled),
      trigger: normalizeOnboardingTrigger(row.trigger),
      steps: normalizeOnboardingSteps(row.steps)
    };
  }

  async configure(
    guildId: string,
    patch: Partial<Pick<OnboardingFlow, "enabled" | "trigger" | "steps">>
  ): Promise<OnboardingFlow> {
    const current = await this.get(guildId);
    const enabled = patch.enabled ?? current.enabled;
    if (typeof enabled !== "boolean") throw new Error("invalid_onboarding_enabled");

    const trigger = patch.trigger === undefined
      ? current.trigger
      : normalizeOnboardingTrigger(patch.trigger);
    const steps = patch.steps === undefined
      ? current.steps
      : normalizeOnboardingSteps(patch.steps);

    await this.db.transaction(async (client) => {
      await client.query(
        "INSERT INTO onboarding_flows(guild_id,enabled,trigger,steps) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,trigger=EXCLUDED.trigger,steps=EXCLUDED.steps,updated_at=now()",
        [guildId, enabled, trigger, JSON.stringify(steps)]
      );
      await client.query(
        "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'onboarding',$2) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()",
        [guildId, enabled]
      );
    });

    return { guildId, enabled, trigger, steps };
  }

  private async execute(guildId: string, userId: string, trigger: OnboardingTrigger): Promise<void> {
    try {
      if (!await moduleEnabled(this.db, guildId, "onboarding", false)) return;

      const flow = await this.get(guildId);
      if (!flow.enabled || flow.trigger !== trigger || flow.steps.length === 0) return;

      const guild = this.client?.guilds.cache.get(guildId);
      if (!guild) {
        logger.warn("Onboarding guild unavailable", { guildId, userId, trigger });
        return;
      }

      const member: GuildMember = await guild.members.fetch(userId);
      let rolesAssigned = 0;
      let messagesSent = 0;
      let dmsSent = 0;
      let errors = 0;

      for (const step of flow.steps) {
        try {
          if (step.type === "role") {
            const role = member.guild.roles.cache.get(step.roleId);
            const bot = member.guild.members.me;
            if (!role || role.managed || role.id === member.guild.id || !bot || role.position >= bot.roles.highest.position) {
              errors += 1;
              logger.warn("Onboarding role step unavailable", { guildId, userId, roleId: step.roleId });
              continue;
            }
            if (!member.roles.cache.has(role.id)) {
              await member.roles.add(role, "Onboarding flow");
              rolesAssigned += 1;
            }
            continue;
          }

          const content = renderTemplate(step.content, {
            mention: "<@" + userId + ">",
            user: member.user.username,
            server: member.guild.name
          });

          if (step.type === "dm") {
            await member.send(content);
            dmsSent += 1;
            continue;
          }

          const channel = member.guild.channels.cache.get(step.channelId);
          if (!channel || !channel.isTextBased() || !("send" in channel)) {
            errors += 1;
            logger.warn("Onboarding channel step unavailable", { guildId, userId, channelId: step.channelId });
            continue;
          }
          await (channel as TextChannel).send(content);
          messagesSent += 1;
        } catch (error) {
          errors += 1;
          logger.warn("Onboarding step failed", {
            guildId, userId, trigger, stepType: step.type, error: String(error)
          });
        }
      }

      await this.auditLog?.record({
        guildId,
        source: "discord",
        action: "onboarding.executed",
        targetType: "member",
        targetId: userId,
        metadata: { trigger, stepCount: flow.steps.length, rolesAssigned, messagesSent, dmsSent, errors }
      }).catch((error) => {
        logger.warn("Onboarding audit failed", { guildId, userId, error: String(error) });
      });
    } catch (error) {
      logger.warn("Onboarding execution failed", {
        guildId, userId, trigger, error: String(error)
      });
    }
  }
}

export function normalizeOnboardingTrigger(value: unknown): OnboardingTrigger {
  if (value === "member.join" || value === "verification.passed") return value;
  throw new Error("invalid_onboarding_trigger");
}

export function normalizeOnboardingSteps(value: unknown): OnboardingStep[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error("invalid_onboarding_steps");

  const roleIds = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid_onboarding_step");
    const item = entry as Record<string, unknown>;

    if (item.type === "role") {
      if (typeof item.roleId !== "string" || !/^\d{17,20}$/.test(item.roleId)) {
        throw new Error("invalid_onboarding_role_step");
      }
      if (roleIds.has(item.roleId)) throw new Error("duplicate_onboarding_role");
      roleIds.add(item.roleId);
      return { type: "role", roleId: item.roleId };
    }

    if (item.type === "channel-message") {
      if (
        typeof item.channelId !== "string" ||
        !/^\d{17,20}$/.test(item.channelId) ||
        typeof item.content !== "string" ||
        !item.content.trim() ||
        item.content.length > 2000
      ) {
        throw new Error("invalid_onboarding_channel_step");
      }
      return {
        type: "channel-message",
        channelId: item.channelId,
        content: item.content.trim()
      };
    }

    if (item.type === "dm") {
      if (typeof item.content !== "string" || !item.content.trim() || item.content.length > 2000) {
        throw new Error("invalid_onboarding_dm_step");
      }
      return { type: "dm", content: item.content.trim() };
    }

    throw new Error("invalid_onboarding_step_type");
  });
}
