import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type FormFieldType = "short" | "paragraph";
export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder: string;
  minLength: number;
  maxLength: number;
};
export type CustomForm = {
  name: string;
  title: string;
  description: string;
  panelChannelId: string | null;
  responseChannelId: string | null;
  buttonLabel: string;
  enabled: boolean;
  fields: FormField[];
};

export const DEFAULT_FORM_FIELDS: readonly FormField[] = [
  { id: "subject", label: "Тема", type: "short", required: true, placeholder: "Кратко опиши вопрос", minLength: 3, maxLength: 100 },
  { id: "details", label: "Описание", type: "paragraph", required: true, placeholder: "Что произошло?", minLength: 10, maxLength: 2000 }
];

export class Forms implements PlatformModule {
  readonly name = "forms";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];
  private auditLog?: ModuleContext["auditLog"];

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.auditLog = undefined;
  }

  async list(guildId: string): Promise<CustomForm[]> {
    const result = await this.db.query<Record<string, unknown>>(
      "SELECT name,title,description,panel_channel_id,response_channel_id,button_label,enabled,fields FROM custom_forms WHERE guild_id=$1 ORDER BY name",
      [guildId]
    );
    return result.rows.map((row) => rowToForm(row));
  }

  async get(guildId: string, name: string): Promise<CustomForm | null> {
    const normalized = normalizeFormName(name);
    if (!normalized) return null;
    const result = await this.db.query<Record<string, unknown>>(
      "SELECT name,title,description,panel_channel_id,response_channel_id,button_label,enabled,fields FROM custom_forms WHERE guild_id=$1 AND name=$2",
      [guildId, normalized]
    );
    return result.rows[0] ? rowToForm(result.rows[0]) : null;
  }

  async save(guildId: string, input: Partial<CustomForm> & { name: string }): Promise<CustomForm> {
    const name = normalizeFormName(input.name);
    if (!name) throw new Error("invalid_form_name");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("invalid_form_enabled");
    if (input.fields !== undefined && !Array.isArray(input.fields)) throw new Error("invalid_form_fields");
    const existing = await this.get(guildId, name);
    const form: CustomForm = {
      name,
      title: normalizeText(input.title ?? existing?.title, "Форма", 256),
      description: normalizeText(input.description ?? existing?.description, "Заполни форму.", 4096),
      panelChannelId: normalizeId(input.panelChannelId ?? existing?.panelChannelId),
      responseChannelId: normalizeId(input.responseChannelId ?? existing?.responseChannelId),
      buttonLabel: normalizeText(input.buttonLabel ?? existing?.buttonLabel, "Заполнить форму", 80),
      enabled: input.enabled ?? existing?.enabled ?? true,
      fields: normalizeFormFields(input.fields ?? existing?.fields ?? DEFAULT_FORM_FIELDS)
    };

    await this.db.query(
      "INSERT INTO custom_forms(guild_id,name,title,description,panel_channel_id,response_channel_id,button_label,enabled,fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(guild_id,name) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,panel_channel_id=EXCLUDED.panel_channel_id,response_channel_id=EXCLUDED.response_channel_id,button_label=EXCLUDED.button_label,enabled=EXCLUDED.enabled,fields=EXCLUDED.fields,updated_at=now()",
      [guildId, form.name, form.title, form.description, form.panelChannelId, form.responseChannelId, form.buttonLabel, form.enabled, JSON.stringify(form.fields)]
    );
    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,$2,true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()",
      [guildId, "forms"]
    );
    return form;
  }

  async delete(guildId: string, name: string): Promise<boolean> {
    const normalized = normalizeFormName(name);
    if (!normalized) throw new Error("invalid_form_name");
    const result = await this.db.query("DELETE FROM custom_forms WHERE guild_id=$1 AND name=$2", [guildId, normalized]);
    return result.rowCount === 1;
  }

  async publish(guildId: string, name: string, channelId?: string): Promise<{ channelId: string; messageId: string }> {
    const form = await this.get(guildId, name);
    if (!form) throw new Error("form_not_found");
    if (!form.enabled) throw new Error("form_disabled");
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error("guild_not_found");
    const channel = guild.channels.cache.get(channelId ?? form.panelChannelId ?? "");
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error("form_panel_channel_required");

    const message = await channel.send({
      embeds: [new EmbedBuilder().setTitle(form.title).setDescription(form.description)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("dsp:form:open:" + form.name).setLabel(form.buttonLabel).setStyle(ButtonStyle.Primary)
        )
      ]
    });

    try {
      await this.db.query(
        "UPDATE custom_forms SET panel_channel_id=$1,panel_message_id=$2,updated_at=now() WHERE guild_id=$3 AND name=$4",
        [channel.id, message.id, guildId, form.name]
      );
    } catch (error) {
      await channel.messages.delete(message.id).catch((cleanupError) => {
        logger.warn("Form publication rollback message delete failed", {
          guildId,
          form: form.name,
          messageId: message.id,
          error: String(cleanupError)
        });
      });
      logger.error("Form publication persistence failed and was rolled back", {
        guildId,
        form: form.name,
        messageId: message.id,
        error: String(error)
      });
      throw error;
    }
    return { channelId: channel.id, messageId: message.id };
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "form") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "publish") return;
    try {
      const result = await this.publish(
        interaction.guild!.id,
        interaction.options.getString("name", true),
        interaction.options.getChannel("channel")?.id
      );
      await this.auditLog?.record({
        guildId: interaction.guild!.id,
        actorUserId: interaction.user.id,
        source: "discord",
        action: "forms.published",
        targetType: "form",
        targetId: interaction.options.getString("name", true).trim().toLowerCase(),
        metadata: result
      });
      await interaction.reply({ content: "Форма опубликована в <#" + result.channelId + ">.", ephemeral: true });
    } catch (error) {
      const formName = interaction.options.getString("name", true).trim().toLowerCase();
      logger.warn("Form publish failed", { guildId: interaction.guild!.id, form: formName, error: String(error) });
      await this.auditLog?.record({
        guildId: interaction.guild!.id,
        actorUserId: interaction.user.id,
        source: "discord",
        action: "forms.publish_failed",
        targetType: "form",
        targetId: formName,
        metadata: { error: String(error) }
      }).catch((auditError) => logger.warn("Form publish failure audit delivery failed", { error: String(auditError) }));
      await interaction.reply({ content: "Не удалось опубликовать форму: " + String(error instanceof Error ? error.message : error), ephemeral: true });
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.guild) return;
    if (interaction.isButton() && interaction.customId.startsWith("dsp:form:open:")) {
      if (!await moduleEnabled(this.db, interaction.guild.id, "forms", false)) {
        await interaction.reply({ content: "Forms выключены.", ephemeral: true });
        return;
      }
      try {
        await this.open(interaction, interaction.customId.slice("dsp:form:open:".length));
      } catch (error) {
        logger.error("Form modal opening failed", {
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          error: String(error)
        });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Не удалось открыть форму.", ephemeral: true });
        }
      }
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("dsp:form:submit:")) {
      if (!await moduleEnabled(this.db, interaction.guild.id, "forms", false)) {
        await interaction.reply({ content: "Forms выключены.", ephemeral: true });
        return;
      }
      try {
        await this.submit(interaction, interaction.customId.slice("dsp:form:submit:".length));
      } catch (error) {
        logger.error("Form submission processing failed", {
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          error: String(error)
        });
        await this.auditLog?.record({
          guildId: interaction.guild.id,
          actorUserId: interaction.user.id,
          source: "discord",
          action: "forms.submission_failed",
          targetType: "form",
          targetId: interaction.customId.slice("dsp:form:submit:".length),
          metadata: { error: String(error) }
        }).catch((auditError) => logger.warn("Form failure audit delivery failed", { error: String(auditError) }));
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Не удалось обработать отправку формы.", ephemeral: true });
        }
      }
    }
  }

  private async open(interaction: ButtonInteraction, name: string): Promise<void> {
    const form = await this.get(interaction.guild!.id, name);
    if (!form || !form.enabled) {
      await interaction.reply({ content: "Форма недоступна.", ephemeral: true });
      return;
    }
    const modal = new ModalBuilder().setCustomId("dsp:form:submit:" + form.name).setTitle(form.title.slice(0, 45));
    for (const field of form.fields) {
      const input = new TextInputBuilder()
        .setCustomId("form:" + field.id)
        .setLabel(field.label)
        .setStyle(field.type === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(field.required)
        .setMinLength(field.minLength)
        .setMaxLength(field.maxLength);
      if (field.placeholder) input.setPlaceholder(field.placeholder);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
    await interaction.showModal(modal);
  }

  private async submit(interaction: ModalSubmitInteraction, name: string): Promise<void> {
    const form = await this.get(interaction.guild!.id, name);
    if (!form || !form.enabled) {
      await interaction.reply({ content: "Форма недоступна.", ephemeral: true });
      return;
    }

    const answers: Record<string, string> = {};
    for (const field of form.fields) {
      const rawAnswer = interaction.fields.getTextInputValue("form:" + field.id);
      answers[field.id] = typeof rawAnswer === "string" ? rawAnswer : "";
    }
    const validation = validateSubmission(form.fields, answers);
    if (validation) {
      await interaction.reply({ content: validation, ephemeral: true });
      return;
    }

    await this.db.query(
      "INSERT INTO custom_form_submissions(guild_id,form_name,user_id,answers) VALUES($1,$2,$3,$4)",
      [interaction.guild!.id, form.name, interaction.user.id, JSON.stringify(answers)]
    );
    await this.auditLog?.record({
      guildId: interaction.guild!.id,
      actorUserId: interaction.user.id,
      source: "discord",
      action: "forms.submitted",
      targetType: "form",
      targetId: form.name,
      metadata: { fieldCount: form.fields.length, responseChannelId: form.responseChannelId }
    });

    if (form.responseChannelId) {
      const channel = interaction.guild!.channels.cache.get(form.responseChannelId);
      if (channel?.type === ChannelType.GuildText) {
        const embed = new EmbedBuilder()
          .setTitle("📨 " + form.title)
          .setDescription("Новая отправка от <@" + interaction.user.id + ">")
          .setTimestamp();
        for (const field of form.fields) {
          embed.addFields({ name: field.label, value: (answers[field.id] ?? "—").slice(0, 1024) });
        }
        await channel.send({ embeds: [embed] }).catch(async (error) => {
          logger.warn("Form response delivery failed", { guildId: interaction.guild!.id, form: form.name, error: String(error) });
          await this.auditLog?.record({
            guildId: interaction.guild!.id,
            actorUserId: interaction.user.id,
            source: "system",
            action: "forms.response_delivery_failed",
            targetType: "form",
            targetId: form.name,
            metadata: { responseChannelId: form.responseChannelId, error: String(error) }
          }).catch((auditError) => logger.warn("Form response failure audit delivery failed", { error: String(auditError) }));
        });
      }
    }

    await interaction.reply({ content: "✅ Форма отправлена.", ephemeral: true });
  }
}

function rowToForm(row: Record<string, unknown>): CustomForm {
  return {
    name: String(row.name),
    title: String(row.title),
    description: String(row.description),
    panelChannelId: row.panel_channel_id ? String(row.panel_channel_id) : null,
    responseChannelId: row.response_channel_id ? String(row.response_channel_id) : null,
    buttonLabel: String(row.button_label),
    enabled: Boolean(row.enabled),
    fields: normalizeFormFields(row.fields)
  };
}

function normalizeFormName(value: string): string {
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(name) ? name : "";
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{17,20}$/.test(value)) throw new Error("invalid_form_channel");
  return value;
}

export function normalizeFormFields(value: unknown): FormField[] {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length > 5) throw new Error("invalid_form_fields");
  const normalized: FormField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_form_fields");
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim().toLowerCase() : "";
    const label = typeof source.label === "string" ? source.label.trim().slice(0, 45) : "";
    const type: FormFieldType = source.type === "paragraph" ? "paragraph" : "short";
    const placeholder = typeof source.placeholder === "string" ? source.placeholder.trim().slice(0, 100) : "";
    const rawMax = typeof source.maxLength === "number" ? Math.trunc(source.maxLength) : type === "paragraph" ? 2000 : 100;
    const maxLength = Math.min(Math.max(rawMax, 1), type === "paragraph" ? 4000 : 400);
    const rawMin = typeof source.minLength === "number" ? Math.trunc(source.minLength) : 0;
    const minLength = Math.min(Math.max(rawMin, 0), maxLength);
    if (!/^[a-z0-9_-]{1,30}$/.test(id) || !label || seen.has(id)) throw new Error("invalid_form_fields");
    seen.add(id);
    normalized.push({ id, label, type, required: source.required !== false, placeholder, minLength, maxLength });
    if (normalized.length >= 5) break;
  }
  return normalized.length ? normalized : [...DEFAULT_FORM_FIELDS];
}

export function validateSubmission(fields: FormField[], answers: Record<string, string>): string | null {
  for (const field of fields) {
    const rawValue = answers[field.id];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (field.required && !value) return "Заполни обязательное поле: " + field.label + ".";
    if (value.length < field.minLength) return "Поле «" + field.label + "» слишком короткое.";
    if (value.length > field.maxLength) return "Поле «" + field.label + "» слишком длинное.";
  }
  return null;
}
