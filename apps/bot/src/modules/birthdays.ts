import { ChannelType, type ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export class Birthdays implements PlatformModule {
  readonly name = "birthdays";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => a();
    this.timer = setInterval(() => void this.processToday(), 60_000);
    this.timer.unref();
    await this.processToday();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "birthday") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "birthdays", false)) {
      await interaction.reply({ content: "Модуль Birthdays выключен.", ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild!.id;

    if (sub === "set") {
      const month = interaction.options.getInteger("month", true);
      const day = interaction.options.getInteger("day", true);
      if (!this.validDate(month, day)) {
        await interaction.reply({ content: "Такой даты в календаре нет.", ephemeral: true });
        return;
      }
      await this.db.query(
        "INSERT INTO birthdays(guild_id,user_id,month,day) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,user_id) DO UPDATE SET month=EXCLUDED.month,day=EXCLUDED.day,updated_at=now()",
        [guildId,interaction.user.id,month,day]
      );
      await interaction.reply({ content: "🎂 День рождения сохранён: " + String(day).padStart(2,"0") + "." + String(month).padStart(2,"0") + ".", ephemeral: true });
      return;
    }

    if (sub === "remove") {
      const deleted = await this.db.query("DELETE FROM birthdays WHERE guild_id=$1 AND user_id=$2",[guildId,interaction.user.id]);
      await interaction.reply({ content: deleted.rowCount ? "🗑️ День рождения удалён." : "Дата не была сохранена.", ephemeral: true });
      return;
    }

    if (sub === "list") {
      const result = await this.db.query<{ user_id:string; month:number; day:number }>(
        "SELECT user_id,month,day FROM birthdays WHERE guild_id=$1 ORDER BY month,day,user_id LIMIT 50",[guildId]
      );
      const content = result.rows.length
        ? "🎂 **Дни рождения**\n" + result.rows.map((row) => "<@" + row.user_id + "> — " + String(row.day).padStart(2,"0") + "." + String(row.month).padStart(2,"0")).join("\n")
        : "Дней рождения пока нет.";
      await interaction.reply({ content });
      return;
    }

    if (sub === "setup") {
      if (!interaction.memberPermissions?.has("ManageGuild")) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Нужен текстовый канал.", ephemeral: true });
        return;
      }
      const template = interaction.options.getString("template")?.trim().slice(0,500);
      await this.db.query(
        "INSERT INTO birthday_settings(guild_id,channel_id,announcement_template) VALUES($1,$2,$3) ON CONFLICT(guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,announcement_template=EXCLUDED.announcement_template,updated_at=now()",
        [guildId,channel.id,template || "🎂 С днём рождения, {user}!"]
      );
      await interaction.reply({ content: "🎂 Канал поздравлений настроен: <#" + channel.id + ">.", ephemeral: true });
    }
  }

  private validDate(month:number,day:number):boolean {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return false;
    const max = new Date(Date.UTC(2024,month,0)).getUTCDate();
    return day <= max;
  }

  private async processToday(): Promise<void> {
    if (!this.client) return;
    for (const guild of this.client.guilds.cache.values()) {
      try {
        if (!await moduleEnabled(this.db,guild.id,"birthdays",false)) continue;
        const settings = await this.db.query<{ channel_id:string|null; announcement_template:string; last_run_date:string|null }>(
          "SELECT channel_id,announcement_template,last_run_date FROM birthday_settings WHERE guild_id=$1",[guild.id]
        );
        const setting = settings.rows[0];
        if (!setting?.channel_id) continue;
        const timezoneResult = await this.db.query<{ timezone:string }>("SELECT timezone FROM guild_settings WHERE guild_id=$1",[guild.id]);
        const timezone = timezoneResult.rows[0]?.timezone || "UTC";
        const parts = new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
        const year = Number(parts.find((part) => part.type === "year")?.value);
        const month = Number(parts.find((part) => part.type === "month")?.value);
        const day = Number(parts.find((part) => part.type === "day")?.value);
        const todayKey = String(year) + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
        if (!Number.isInteger(month) || !Number.isInteger(day) || setting.last_run_date === todayKey) continue;

        const birthdays = await this.db.query<{ user_id:string }>(
          "SELECT user_id FROM birthdays WHERE guild_id=$1 AND month=$2 AND day=$3 ORDER BY user_id",[guild.id,month,day]
        );
        const channel = guild.channels.cache.get(setting.channel_id);
        if (birthdays.rows.length && channel?.isTextBased() && "send" in channel) {
          const mentions = birthdays.rows.map((row) => "<@" + row.user_id + ">").join(", ");
          const content = renderTemplate(setting.announcement_template,mentions,guild.name);
          await channel.send({ content, allowedMentions:{ users:birthdays.rows.map((row) => row.user_id), parse:[] } });
        }
        await this.db.query("UPDATE birthday_settings SET last_run_date=$1,updated_at=now() WHERE guild_id=$2",[todayKey,guild.id]);
      } catch (error) {
        logger.warn("Birthday daily processing failed",{guildId:guild.id,error:String(error)});
      }
    }
  }
}

function renderTemplate(template:string,user:string,server:string):string {
  return (template || "🎂 С днём рождения, {user}!").replaceAll("{user}",user).replaceAll("{server}",server);
}
