import { type ChatInputCommandInteraction, PermissionFlagsBits, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Leveling implements PlatformModule {
  readonly name = "leveling";
  private unsubscribe?: () => void;
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("message.create", (message) => this.onMessage(message));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cooldowns.clear();
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "leveling") return;

    const sub = interaction.options.getSubcommand();
    if (sub === "setup") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }
      await this.db.query(
        `INSERT INTO leveling_settings(guild_id,enabled,xp_per_message,cooldown_seconds,announce_level_up)
         VALUES($1,true,$2,$3,$4)
         ON CONFLICT(guild_id) DO UPDATE SET enabled=true,xp_per_message=EXCLUDED.xp_per_message,cooldown_seconds=EXCLUDED.cooldown_seconds,announce_level_up=EXCLUDED.announce_level_up,updated_at=now()`,
        [
          interaction.guild.id,
          interaction.options.getInteger("xp") ?? 10,
          interaction.options.getInteger("cooldown") ?? 30,
          interaction.options.getBoolean("announce") ?? true
        ]
      );
      await this.db.query(
        `INSERT INTO guild_modules(guild_id,module_key,enabled)
         VALUES($1,'leveling',true)
         ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()`,
        [interaction.guild.id]
      );
      await interaction.reply({ content: "Leveling настроен и включён.", ephemeral: true });
      return;
    }

    if (!await moduleEnabled(this.db, interaction.guild.id, "leveling", false)) {
      await interaction.reply({ content: "Модуль Leveling выключен.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    const result = await this.db.query<{ xp: number; level: number }>(
      "SELECT xp,level FROM leveling_users WHERE guild_id=$1 AND user_id=$2",
      [interaction.guild.id,target.id]
    );

    if (sub === "rank") {
      const row = result.rows[0];
      await interaction.reply({
        content: row ? `🏆 ${target}: уровень **${row.level}**, XP **${row.xp}**` : `${target} пока не имеет XP.`,
        ephemeral: true
      });
      return;
    }

    if (sub === "top") {
      const top = await this.db.query<{ user_id: string; xp: number; level: number }>(
        "SELECT user_id,xp,level FROM leveling_users WHERE guild_id=$1 ORDER BY xp DESC LIMIT 10",
        [interaction.guild.id]
      );
      const lines = top.rows.map((row, index) => `${index + 1}. <@${row.user_id}> · lvl ${row.level} · ${row.xp} XP`);
      await interaction.reply({ content: lines.length ? `📈 **Топ Leveling**\n${lines.join("\n")}` : "Таблица лидеров пуста.", ephemeral: true });
    }
  }

  private async onMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "leveling", false)) return;

    const settings = await this.db.query<{ xp_per_message: number; cooldown_seconds: number; announce_level_up: boolean }>(
      "SELECT xp_per_message,cooldown_seconds,announce_level_up FROM leveling_settings WHERE guild_id=$1",
      [message.guild.id]
    );
    const setting = settings.rows[0] ?? { xp_per_message: 10, cooldown_seconds: 30, announce_level_up: true };
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const previous = this.cooldowns.get(key) ?? 0;
    if (now - previous < setting.cooldown_seconds * 1000) return;
    this.cooldowns.set(key, now);

    const xp = setting.xp_per_message;
    const result = await this.db.query<{ xp: number; level: number }>(
      `INSERT INTO leveling_users(guild_id,user_id,xp,level)
       VALUES($1,$2,$3,0)
       ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=leveling_users.xp+EXCLUDED.xp
       RETURNING xp,level`,
      [message.guild.id, message.author.id, xp]
    );

    const row = result.rows[0];
    if (!row) return;

    const nextLevel = Math.floor(Math.sqrt(row.xp / 100));
    if (nextLevel > row.level) {
      await this.db.query(
        "UPDATE leveling_users SET level=$1,updated_at=now() WHERE guild_id=$2 AND user_id=$3",
        [nextLevel, message.guild.id, message.author.id]
      );
      if (setting.announce_level_up) {
        await message.channel.send(
          `🎉 <@${message.author.id}> достиг уровня **${nextLevel}**!`
        ).catch(() => undefined);
      }
    }
  }
}
