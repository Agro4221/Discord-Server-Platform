import type { ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Economy implements PlatformModule {
  readonly name = "economy";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "economy") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "economy", false)) {
      await interaction.reply({ content: "Модуль Economy выключен.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "balance") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const balance = await this.balance(interaction.guild.id, user.id);
      await interaction.reply({ content: `💰 ${user}: **${balance}** coins.`, ephemeral: true });
      return;
    }

    if (sub === "daily") {
      const amount = 100;
      const result = await this.db.query<{ balance: number; last_daily: Date | null }>(
        `INSERT INTO economy_accounts(guild_id,user_id,balance,last_daily)
         VALUES($1,$2,$3,now())
         ON CONFLICT(guild_id,user_id) DO UPDATE SET
           balance=economy_accounts.balance+$3,last_daily=now()
         WHERE economy_accounts.last_daily IS NULL OR economy_accounts.last_daily < now()-interval '23 hours'
         RETURNING balance,last_daily`,
        [interaction.guild.id, interaction.user.id, amount]
      );
      if (result.rows.length === 0) {
        await interaction.reply({ content: "Daily уже забран. Возвращайся позже.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: `🎁 Получено **${amount}** coins. Баланс: **${result.rows[0]!.balance}**.`, ephemeral: true });
      return;
    }

    if (sub === "pay") {
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      if (target.bot || target.id === interaction.user.id || amount <= 0) {
        await interaction.reply({ content: "Некорректный получатель или сумма.", ephemeral: true });
        return;
      }

      const moved = await this.transfer(interaction.guild.id, interaction.user.id, target.id, amount);
      await interaction.reply({
        content: moved
          ? `💸 Переведено **${amount}** coins пользователю ${target}.`
          : "Недостаточно средств.",
        ephemeral: true
      });
    }
  }

  private async balance(guildId: string, userId: string): Promise<number> {
    const result = await this.db.query<{ balance: number }>(
      "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    return result.rows[0]?.balance ?? 0;
  }

  private async transfer(guildId: string, from: string, to: string, amount: number): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const sender = await client.query<{ balance: number }>(
        "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId, from]
      );
      const balance = sender.rows[0]?.balance ?? 0;
      if (balance < amount) return false;

      await client.query(
        `INSERT INTO economy_accounts(guild_id,user_id,balance) VALUES($1,$2,0)
         ON CONFLICT(guild_id,user_id) DO NOTHING`,
        [guildId, to]
      );
      await client.query(
        "UPDATE economy_accounts SET balance=balance-$3 WHERE guild_id=$1 AND user_id=$2",
        [guildId, from, amount]
      );
      await client.query(
        "UPDATE economy_accounts SET balance=balance+$3 WHERE guild_id=$1 AND user_id=$2",
        [guildId, to, amount]
      );
      return true;
    });
  }
}
