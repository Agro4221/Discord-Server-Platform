import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type MessageContextMenuCommandInteraction,
  type UserContextMenuCommandInteraction
} from "discord.js";
import type { CommandPolicyService } from "./command-policy.js";
import type { Moderation } from "./modules/moderation.js";
import type { AuditLog } from "./audit.js";
import type { ModuleContext, PlatformModule } from "./module.js";
import { logger } from "./logger.js";

export const CONTEXT_COMMAND_NAMES = {
  userInfo: "User Info",
  moderationHistory: "Moderation History",
  avatar: "User Avatar",
  quoteMessage: "Quote Message",
  deleteMessage: "Delete Message"
} as const;

export function buildContextCommands(): ContextMenuCommandBuilder[] {
  return [
    new ContextMenuCommandBuilder()
      .setName(CONTEXT_COMMAND_NAMES.userInfo)
      .setType(ApplicationCommandType.User),
    new ContextMenuCommandBuilder()
      .setName(CONTEXT_COMMAND_NAMES.moderationHistory)
      .setType(ApplicationCommandType.User)
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers.toString()),
    new ContextMenuCommandBuilder()
      .setName(CONTEXT_COMMAND_NAMES.avatar)
      .setType(ApplicationCommandType.User),
    new ContextMenuCommandBuilder()
      .setName(CONTEXT_COMMAND_NAMES.quoteMessage)
      .setType(ApplicationCommandType.Message),
    new ContextMenuCommandBuilder()
      .setName(CONTEXT_COMMAND_NAMES.deleteMessage)
      .setType(ApplicationCommandType.Message)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
  ];
}

export class ContextCommandService implements PlatformModule {
  readonly name = "context-commands";

  private unsubscribe?: () => void;
  private auditLog?: AuditLog;

  constructor(
    private readonly commandPolicy: CommandPolicyService,
    private readonly moderation: Moderation
  ) {}

  async init(context: ModuleContext): Promise<void> {
    this.auditLog = context.auditLog;
    this.unsubscribe = context.events.on("interaction", (interaction) => this.handle(interaction));
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.auditLog = undefined;
  }

  private async handle(
    interaction: import("discord.js").Interaction
  ): Promise<void> {
    if (!isKnownContextCommand(interaction)) return;

    try {
      if (interaction.isUserContextMenuCommand()) {
        await this.handleUser(interaction);
        return;
      }
      if (interaction.isMessageContextMenuCommand()) {
        await this.handleMessage(interaction);
      }
    } catch (error) {
      logger.error("Context command failed", {
        command: interaction.isContextMenuCommand() ? interaction.commandName : "unknown",
        guildId: interaction.guildId,
        userId: interaction.user.id,
        error: String(error)
      });

      if (!interaction.isRepliable()) return;

      const reply = {
        content: "Не удалось выполнить контекстную команду.",
        ephemeral: true
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => undefined);
      } else {
        await interaction.reply(reply).catch(() => undefined);
      }
    }
  }

  private async handleUser(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    if (!interaction.inGuild()) return;
    if (!await this.commandPolicy.checkContext(interaction, interaction.commandName)) return;

    if (interaction.commandName === CONTEXT_COMMAND_NAMES.avatar) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Аватар пользователя")
            .setDescription(interaction.targetUser.toString())
            .setImage(interaction.targetUser.displayAvatarURL({ size: 1024 }))
            .setTimestamp()
        ],
        ephemeral: true
      });
      return;
    }

    const member = await interaction.guild!.members.fetch(interaction.targetUser.id).catch(() => null);

    if (interaction.commandName === CONTEXT_COMMAND_NAMES.moderationHistory) {
      const cases = await this.moderation.history(interaction.guild!.id, interaction.targetUser.id, 10);
      if (!cases.length) {
        await interaction.reply({
          content: `📋 У ${interaction.targetUser} нет зарегистрированных moderation cases.`,
          ephemeral: true
        });
        return;
      }

      const description = cases.map((item) => {
        const reason = item.reason ? item.reason.slice(0, 180) : "Без причины";
        const moderator = item.moderatorUserId === "dashboard"
          ? "Dashboard"
          : `<@${item.moderatorUserId}>`;
        return `**#${item.id} · ${item.action}** · ${moderator} · ${reason}`;
      }).join("\n");

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Moderation History · ${interaction.targetUser.username}`)
            .setDescription(description.slice(0, 3900))
            .setFooter({ text: `Показаны последние ${cases.length} cases` })
            .setTimestamp()
        ],
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Информация о пользователе")
      .setThumbnail(interaction.targetUser.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: "Пользователь",
          value: `${interaction.targetUser} · ${interaction.targetUser.username}\nID: \`${interaction.targetUser.id}\``
        },
        {
          name: "Аккаунт создан",
          value: `<t:${Math.floor(interaction.targetUser.createdTimestamp / 1000)}:F>`,
          inline: true
        }
      )
      .setTimestamp();

    if (member) this.addMemberFields(embed, member);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private addMemberFields(embed: EmbedBuilder, member: GuildMember): void {
    const roles = member.roles.cache
      .filter((role) => role.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString())
      .slice(0, 15);

    embed.addFields(
      {
        name: "На сервере с",
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
          : "Неизвестно",
        inline: true
      },
      {
        name: "Ролей",
        value: roles.length ? roles.join(", ") : "Нет",
        inline: false
      }
    );
  }

  private async handleMessage(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    if (!interaction.inGuild()) return;
    if (!await this.commandPolicy.checkContext(interaction, interaction.commandName)) return;

    const message = interaction.targetMessage;

    if (interaction.commandName === CONTEXT_COMMAND_NAMES.deleteMessage) {
      await message.delete();
      await this.auditLog?.record({
        guildId: interaction.guild!.id,
        actorUserId: interaction.user.id,
        source: "discord",
        action: "moderation.context.delete_message",
        targetType: "message",
        targetId: message.id,
        metadata: {
          channelId: message.channelId,
          authorUserId: message.author.id,
          content: message.content.slice(0, 1000)
        }
      });
      await interaction.reply({
        content: `🗑️ Сообщение ${message.id} удалено.`,
        ephemeral: true
      });
      return;
    }

    const content = message.content.trim() || "*[сообщение без текста]*";
    const attachmentLines = [...message.attachments.values()]
      .map((attachment) => attachment.url)
      .slice(0, 5);

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.globalName ?? message.author.username,
        iconURL: message.author.displayAvatarURL({ size: 128 })
      })
      .setDescription(content.slice(0, 3900))
      .addFields(
        { name: "Канал", value: `<#${message.channelId}>`, inline: true },
        { name: "Автор", value: `<@${message.author.id}>`, inline: true }
      )
      .setURL(message.url)
      .setTimestamp(message.createdAt);

    if (attachmentLines.length) {
      embed.addFields({
        name: "Вложения",
        value: attachmentLines.map((url) => `[Открыть](${url})`).join("\n").slice(0, 1000)
      });
      const imageAttachment = [...message.attachments.values()].find((attachment) =>
        attachment.contentType?.startsWith("image/")
      );
      if (imageAttachment) embed.setImage(imageAttachment.url);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}


function isKnownContextCommand(
  interaction: import("discord.js").Interaction
): interaction is UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction {
  if (!interaction.isContextMenuCommand()) return false;
  return (Object.values(CONTEXT_COMMAND_NAMES) as string[]).includes(interaction.commandName);
}
