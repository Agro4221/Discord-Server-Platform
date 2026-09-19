import type { ChatInputCommandInteraction, GuildMember, TextChannel } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type SecurityConfig = {
  enabled: boolean;
  maxJoins: number;
  windowSeconds: number;
  quarantineRoleId: string | null;
  logChannelId: string | null;
};

export class Security implements PlatformModule {
  readonly name = "security";
  private unsubscribe?: () => void;
  private readonly joins = new Map<string, number[]>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("member.add", (member) => this.onJoin(member));
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.joins.clear();
  }

  private async config(guildId: string): Promise<SecurityConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      max_joins: number;
      window_seconds: number;
      quarantine_role_id: string | null;
      log_channel_id: string | null;
    }>(
      "SELECT enabled,max_joins,window_seconds,quarantine_role_id,log_channel_id FROM security_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];

    return {
      enabled: row?.enabled ?? false,
      maxJoins: row?.max_joins ?? 10,
      windowSeconds: row?.window_seconds ?? 20,
      quarantineRoleId: row?.quarantine_role_id ?? null,
      logChannelId: row?.log_channel_id ?? null
    };
  }

  async configure(guildId: string, patch: Partial<SecurityConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };

    await this.db.query(
      `INSERT INTO security_settings(guild_id,enabled,max_joins,window_seconds,quarantine_role_id,log_channel_id)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,max_joins=EXCLUDED.max_joins,window_seconds=EXCLUDED.window_seconds,
       quarantine_role_id=EXCLUDED.quarantine_role_id,log_channel_id=EXCLUDED.log_channel_id,updated_at=now()`,
      [guildId,next.enabled,Math.min(Math.max(next.maxJoins,2),200),Math.min(Math.max(next.windowSeconds,5),300),next.quarantineRoleId,next.logChannelId]
    );

    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'security',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId, next.enabled]
    );
  }

  private async onJoin(member: GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "security", false)) return;
    const config = await this.config(member.guild.id);
    if (!config.enabled) return;

    const now = Date.now();
    const cutoff = now - config.windowSeconds * 1000;
    const bucket = (this.joins.get(member.guild.id) ?? []).filter((timestamp) => timestamp >= cutoff);
    bucket.push(now);
    this.joins.set(member.guild.id, bucket);

    if (bucket.length < config.maxJoins) return;

    await this.db.query(
      "INSERT INTO security_events(guild_id,event_type,metadata) VALUES($1,'raid-detected',$2::jsonb)",
      [member.guild.id, JSON.stringify({ joins: bucket.length, windowSeconds: config.windowSeconds })]
    );

    if (config.quarantineRoleId && member.manageable) {
      const role = member.guild.roles.cache.get(config.quarantineRoleId);
      if (role && role.position < member.guild.members.me!.roles.highest.position) {
        await member.roles.add(role, "Security anti-raid quarantine").catch(() => undefined);
      }
    }

    if (config.logChannelId) {
      const channel = member.guild.channels.cache.get(config.logChannelId);
      if (channel?.isTextBased() && "send" in channel) {
        await (channel as TextChannel).send(
          `🚨 **Anti-Raid:** за ${config.windowSeconds} сек. обнаружено ${bucket.length} входов.`
        ).catch(() => undefined);
      }
    }
  }
}
