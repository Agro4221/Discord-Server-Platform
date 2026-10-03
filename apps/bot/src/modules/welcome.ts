import {
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled, renderTemplate } from "../module-utils.js";
import { logger } from "../logger.js";

type WelcomeConfig = {
  enabled: boolean;
  channelId: string | null;
  message: string;
  dm: boolean;
  embed: boolean;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string | null;
  goodbyeMessage: string;
  goodbyeEmbed: boolean;
  starterRoleIds: string;
  restoreRoles: boolean;
};

const defaultConfig: WelcomeConfig = {
  enabled: false,
  channelId: null,
  message: "Добро пожаловать, {mention}, на {server}!",
  dm: false,
  embed: true,
  goodbyeEnabled: false,
  goodbyeChannelId: null,
  goodbyeMessage: "{user} покинул {server}.",
  goodbyeEmbed: true,
  starterRoleIds: "",
  restoreRoles: false
};

export class Welcome implements PlatformModule {
  readonly name = "welcome";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("member.add", (member) => this.onJoin(member));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const c = context.events.on("member.remove", (member) => this.onLeave(member));
    this.unsubscribe = () => { a(); b(); c(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async handlePrefixCommand(message: import("discord.js").Message, commandName: string, args: string[]): Promise<boolean> {
    if (commandName !== "welcome") return false;
    if (!message.guild) return false;

    const sub = (args.shift() ?? "setup").toLowerCase();
    if (sub !== "setup") {
      await message.reply("Использование: !welcome setup [#канал] [текст] [--dm|--no-dm] [--embed|--no-embed]");
      return true;
    }

    const channelMention = message.mentions.channels.first();
    const filtered = args.filter((arg) => !/^<#\d{15,25}>$/.test(arg));
    const flags = new Set(filtered.filter((arg) => /^--(?:no-)?(?:dm|embed)$/i.test(arg)).map((arg) => arg.toLowerCase()));
    const messageText = filtered.filter((arg) => !/^--(?:no-)?(?:dm|embed)$/i.test(arg)).join(" ").trim();

    const patch: Partial<WelcomeConfig> = {};
    if (channelMention) patch.channelId = channelMention.id;
    if (messageText) patch.message = messageText.slice(0, 2000);
    if (flags.has("--dm")) patch.dm = true;
    if (flags.has("--no-dm")) patch.dm = false;
    if (flags.has("--embed")) patch.embed = true;
    if (flags.has("--no-embed")) patch.embed = false;
    patch.enabled = true;

    await this.configure(message.guild.id, patch);
    await message.reply("Welcome настроен и включён.");
    return true;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "welcome") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "setup") return;

    const channelOption = interaction.options.getChannel("channel");
    const channel = channelOption ? interaction.guild!.channels.cache.get(channelOption.id) : null;
    if (channelOption && (!channel || channel.type !== 0)) {
      await interaction.reply({ content: "Welcome channel должен быть текстовым.", ephemeral: true });
      return;
    }

    await this.configure(interaction.guild!.id, {
      enabled: true,
      channelId: channel?.id ?? null,
      message: interaction.options.getString("message") ?? defaultConfig.message,
      dm: interaction.options.getBoolean("dm") ?? false,
      embed: interaction.options.getBoolean("embed") ?? true,
      goodbyeEnabled: undefined,
      goodbyeChannelId: undefined,
      goodbyeMessage: undefined,
      goodbyeEmbed: undefined,
      starterRoleIds: undefined,
      restoreRoles: undefined
    });

    await interaction.reply({ content: "Welcome настроен и включён.", ephemeral: true });
  }

  async getConfig(guildId: string): Promise<WelcomeConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      message: string;
      dm: boolean;
      embed: boolean;
      goodbye_enabled: boolean;
      goodbye_channel_id: string | null;
      goodbye_message: string;
      goodbye_embed: boolean;
      starter_role_ids: string;
      restore_roles: boolean;
    }>(
      "SELECT enabled,channel_id,message,dm,embed,goodbye_enabled,goodbye_channel_id,goodbye_message,goodbye_embed,starter_role_ids,restore_roles FROM welcome_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return defaultConfig;
    return {
      enabled: row.enabled,
      channelId: row.channel_id,
      message: row.message,
      dm: row.dm,
      embed: row.embed,
      goodbyeEnabled: row.goodbye_enabled,
      goodbyeChannelId: row.goodbye_channel_id,
      goodbyeMessage: row.goodbye_message,
      goodbyeEmbed: row.goodbye_embed,
      starterRoleIds: row.starter_role_ids,
      restoreRoles: row.restore_roles
    };
  }

  async configure(guildId: string, patch: Partial<WelcomeConfig>): Promise<void> {
    const current = await this.getConfig(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO welcome_settings(
         guild_id,enabled,channel_id,message,dm,embed,
         goodbye_enabled,goodbye_channel_id,goodbye_message,goodbye_embed,starter_role_ids,restore_roles
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,message=EXCLUDED.message,
         dm=EXCLUDED.dm,embed=EXCLUDED.embed,goodbye_enabled=EXCLUDED.goodbye_enabled,
         goodbye_channel_id=EXCLUDED.goodbye_channel_id,goodbye_message=EXCLUDED.goodbye_message,
         goodbye_embed=EXCLUDED.goodbye_embed,starter_role_ids=EXCLUDED.starter_role_ids,
         restore_roles=EXCLUDED.restore_roles,updated_at=now()`,
      [
        guildId,next.enabled,next.channelId,next.message,next.dm,next.embed,
        next.goodbyeEnabled,next.goodbyeChannelId,next.goodbyeMessage,next.goodbyeEmbed,
        next.starterRoleIds,next.restoreRoles
      ]
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
          }).catch((error) => {
            logger.warn("Welcome embed delivery failed", {
              guildId: member.guild.id,
              channelId: channel.id,
              userId: member.id,
              error: String(error)
            });
          });
        } else {
          await (channel as TextChannel).send(content).catch((error) => {
            logger.warn("Welcome message delivery failed", {
              guildId: member.guild.id,
              channelId: channel.id,
              userId: member.id,
              error: String(error)
            });
          });
        }
      }
    }

    const stored = await this.db.query<{ role_ids: string[] }>(
      "SELECT role_ids FROM welcome_role_snapshots WHERE guild_id=$1 AND user_id=$2",
      [member.guild.id, member.id]
    );
    const snapshotRoles = config.restoreRoles ? (stored.rows[0]?.role_ids ?? []) : [];
    const starterRoles = config.starterRoleIds.split(/[,\\s]+/).filter(Boolean);
    const candidateRoles = [...new Set([...snapshotRoles, ...starterRoles])];

    if (candidateRoles.length && member.guild.members.me) {
      const rolesToAdd = candidateRoles
        .map((id) => member.guild.roles.cache.get(id))
        .filter((role): role is NonNullable<typeof role> => Boolean(role))
        .filter((role) => !role.managed && role.position < member.guild.members.me!.roles.highest.position);
      if (rolesToAdd.length) {
        await member.roles.add(rolesToAdd, "Vexa welcome role assignment").catch((error) => {
          logger.warn("Welcome role assignment failed", {
            guildId: member.guild.id,
            userId: member.id,
            error: String(error)
          });
        });
      }
    }

    if (stored.rows[0]) {
      await this.db.query(
        "DELETE FROM welcome_role_snapshots WHERE guild_id=$1 AND user_id=$2",
        [member.guild.id, member.id]
      ).catch(() => undefined);
    }

    if (config.dm) {
      await member.send(content).catch((error) => {
        logger.warn("Welcome DM delivery failed", {
          guildId: member.guild.id,
          userId: member.id,
          error: String(error)
        });
      });
    }
  }

  private async onLeave(member: GuildMember): Promise<void> {
    const config = await this.getConfig(member.guild.id);
    if (!config.restoreRoles && !config.goodbyeEnabled) return;

    if (config.restoreRoles) {
      const botHighest = member.guild.members.me?.roles.highest.position ?? -1;
      const roleIds = member.roles.cache
        .filter((role) => !role.managed && role.position < botHighest)
        .map((role) => role.id);
      await this.db.query(
        "INSERT INTO welcome_role_snapshots(guild_id,user_id,role_ids) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET role_ids=EXCLUDED.role_ids,updated_at=now()",
        [member.guild.id,member.id,roleIds]
      );
    }

    if (!config.goodbyeEnabled) return;
    const content = renderTemplate(config.goodbyeMessage, {
      mention: `<@${member.id}>`,
      user: member.user.username,
      server: member.guild.name
    });
    const channelId = config.goodbyeChannelId ?? config.channelId;
    if (!channelId) return;
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) return;

    if (config.goodbyeEmbed) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`До встречи, ${member.user.username}`)
            .setDescription(content)
            .setThumbnail(member.displayAvatarURL({ size: 128 }))
        ]
      }).catch((error) => logger.warn("Goodbye embed delivery failed", {
        guildId: member.guild.id,channelId,userId: member.id,error: String(error)
      }));
    } else {
      await channel.send(content).catch((error) => logger.warn("Goodbye delivery failed", {
        guildId: member.guild.id,channelId,userId: member.id,error: String(error)
      }));
    }
  }
}
