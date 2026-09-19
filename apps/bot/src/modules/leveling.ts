import type { Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Leveling implements PlatformModule {
  readonly name = "leveling";
  private unsubscribe?: () => void;
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("message.create", (message) => this.onMessage(message));
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cooldowns.clear();
  }

  private async onMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "leveling", false)) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const previous = this.cooldowns.get(key) ?? 0;
    if (now - previous < 30_000) return;
    this.cooldowns.set(key, now);

    const xp = 10 + Math.floor(Math.random() * 11);
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
      await message.channel.send(
        `🎉 <@${message.author.id}> достиг уровня **${nextLevel}**!`
      ).catch(() => undefined);
    }
  }
}
