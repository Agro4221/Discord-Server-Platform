import {
  EmbedBuilder,
  type GuildMember,
  type TextChannel
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled, renderTemplate } from "../module-utils.js";

type WelcomeConfig = {
  enabled: boolean;
  channelId: string | null;
  message: string;
  dm: boolean;
  embed: boolean;
};

const defaultConfig: WelcomeConfig = {
  enabled: false,
  channelId: null,
  message: "Добро пожаловать, {mention}, на {server}!",
  dm: false,
  embed: true
};

export class Welcome implements PlatformModule {
  readonly name = "welcome";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("member.add", (member) => this.onJoin(member));
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async getConfig(guildId: string): Promise<WelcomeConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      message: string;
      dm: boolean;
      embed: boolean;
    }>(
      "SELECT enabled,channel_id,message,dm,embed FROM welcome_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return defaultConfig;
    return {
      enabled: row.enabled,
      channelId: row.channel_id,
      message: row.message,
      dm: row.dm,
      embed: row.embed
    };
  }

  async configure(guildId: string, patch: Partial<WelcomeConfig>): Promise<void> {
    const current = await this.getConfig(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO welcome_settings(guild_id,enabled,channel_id,message,dm,embed)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,message=EXCLUDED.message,
       dm=EXCLUDED.dm,embed=EXCLUDED.embed,updated_at=now()`,
      [guildId, next.enabled, next.channelId, next.message, next.dm, next.embed]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'welcome',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId, next.enabled]
    );
  }

  private async onJoin(member: GuildMember): Promise<void> {
    if (!await moduleEnabled(this.db, member.guild.id, "welcome", false)) return;
    const config = await this.getConfig(member.guild.id);
    if (!config.enabled) return;

    const content = renderTemplate(config.message, {
      mention: `<@${member.id}>`,
      user: member.user.username,
      server: member.guild.name
    });

    if (config.channelId) {
      const channel = member.guild.channels.cache.get(config.channelId);
      if (channel?.isTextBased() && "send" in channel) {
        if (config.embed) {
          await (channel as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`Добро пожаловать на ${member.guild.name}`)
                .setDescription(content)
                .setThumbnail(member.displayAvatarURL({ size: 128 }))
            ]
          }).catch(() => undefined);
        } else {
          await (channel as TextChannel).send(content).catch(() => undefined);
        }
      }
    }

    if (config.dm) {
      await member.send(content).catch(() => undefined);
    }
  }
}
