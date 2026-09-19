import {
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type ShopItem = {
  id: number;
  name: string;
  description: string;
  price: number;
  roleId: string | null;
  stock: number | null;
};

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
    if (!interaction.inGuild()) return;
    if (!["economy", "shop"].includes(interaction.commandName)) return;

    if (!await moduleEnabled(this.db, interaction.guild!.id, "economy", false)) {
      await interaction.reply({ content: "Модуль Economy выключен.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "economy") {
      await this.economyCommand(interaction);
    } else {
      await this.shopCommand(interaction);
    }
  }

  private async economyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === "balance") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const balance = await this.balance(interaction.guild!.id, user.id);
      await interaction.reply({ content: `💰 ${user}: **${balance}** coins.`, ephemeral: true });
      return;
    }

    if (sub === "daily") {
      const result = await this.db.query<{ balance: number }>(
        `INSERT INTO economy_accounts(guild_id,user_id,balance,last_daily)
         VALUES($1,$2,100,now())
         ON CONFLICT(guild_id,user_id) DO UPDATE SET
           balance=economy_accounts.balance+100,
           last_daily=now(),
           updated_at=now()
         WHERE economy_accounts.last_daily IS NULL
            OR economy_accounts.last_daily < now()-interval '23 hours'
         RETURNING balance`,
        [interaction.guild!.id, interaction.user.id]
      );

      if (!result.rows[0]) {
        await interaction.reply({ content: "Daily уже забран. Возвращайся позже.", ephemeral: true });
        return;
      }

      await this.recordTransaction(interaction.guild!.id, interaction.user.id, "daily", 100);
      await interaction.reply({ content: `🎁 Получено **100** coins. Баланс: **${result.rows[0].balance}**.`, ephemeral: true });
      return;
    }

    if (sub === "pay") {
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      if (target.bot || target.id === interaction.user.id || amount <= 0) {
        await interaction.reply({ content: "Некорректный получатель или сумма.", ephemeral: true });
        return;
      }

      const moved = await this.transfer(interaction.guild!.id, interaction.user.id, target.id, amount);
      await interaction.reply({
        content: moved ? `💸 Переведено **${amount}** coins пользователю ${target}.` : "Недостаточно средств.",
        ephemeral: true
      });
      return;
    }

    if (sub === "leaderboard") {
      const result = await this.db.query<{ user_id: string; balance: number }>(
        "SELECT user_id,balance FROM economy_accounts WHERE guild_id=$1 ORDER BY balance DESC LIMIT 10",
        [interaction.guild!.id]
      );
      const lines = result.rows.map((row, index) => `${index + 1}. <@${row.user_id}> · ${row.balance} coins`);
      await interaction.reply({ content: lines.length ? `🏦 **Экономика**\n${lines.join("\n")}` : "Балансов пока нет.", ephemeral: true });
    }
  }

  private async shopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const items = await this.items(interaction.guild!.id);
      if (!items.length) {
        await interaction.reply({ content: "Магазин пуст.", ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🛒 Магазин")
        .setDescription(
          items.map((item) => {
            const stock = item.stock === null ? "" : `\nОстаток: ${item.stock}`;
            return `**#${item.id} · ${item.name}** — ${item.price} coins\n${item.description}${stock}`;
          }).join("\n\n")
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "create") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }

      const role = interaction.options.getRole("role");
      const price = interaction.options.getInteger("price", true);
      if (role && role.position >= (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
        await interaction.reply({ content: "Бот не может управлять этой ролью из-за role hierarchy.", ephemeral: true });
        return;
      }

      const result = await this.db.query<{ id: string }>(
        `INSERT INTO economy_shop_items(guild_id,name,description,price,role_id,stock)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          interaction.guild!.id,
          interaction.options.getString("name", true),
          interaction.options.getString("description", true),
          price,
          role?.id ?? null,
          interaction.options.getInteger("stock")
        ]
      );

      await interaction.reply({ content: `Товар #${result.rows[0]?.id ?? "?"} создан.`, ephemeral: true });
      return;
    }

    if (sub === "buy") {
      const itemId = interaction.options.getInteger("item", true);
      const item = (await this.items(interaction.guild!.id)).find((candidate) => candidate.id === itemId);
      if (!item) {
        await interaction.reply({ content: "Товар не найден.", ephemeral: true });
        return;
      }

      const bought = await this.purchase(interaction.guild!.id, interaction.user.id, item);
      if (!bought) {
        await interaction.reply({ content: "Не хватает coins или товар закончился.", ephemeral: true });
        return;
      }

      if (item.roleId) {
        const role = interaction.guild!.roles.cache.get(item.roleId);
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        if (role && member.manageable && role.position < (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
          await member.roles.add(role, "Economy shop purchase").catch(() => undefined);
        }
      }

      await interaction.reply({ content: `✅ Куплено: **${item.name}** за ${item.price} coins.`, ephemeral: true });
    }
  }

  private async balance(guildId: string, userId: string): Promise<number> {
    const result = await this.db.query<{ balance: number }>(
      "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2",
      [guildId,userId]
    );
    return result.rows[0]?.balance ?? 0;
  }

  private async items(guildId: string): Promise<ShopItem[]> {
    const result = await this.db.query<{ id: string; name: string; description: string; price: number; role_id: string | null; stock: number | null }>(
      "SELECT id,name,description,price,role_id,stock FROM economy_shop_items WHERE guild_id=$1 AND enabled=true ORDER BY id",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description,
      price: row.price,
      roleId: row.role_id,
      stock: row.stock
    }));
  }

  private async purchase(guildId: string, userId: string, item: ShopItem): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const account = await client.query<{ balance: number }>(
        "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId,userId]
      );
      const balance = account.rows[0]?.balance ?? 0;
      if (balance < item.price) return false;

      const itemRow = await client.query<{ id: string }>(
        `UPDATE economy_shop_items
         SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-1 END,updated_at=now()
         WHERE id=$1 AND guild_id=$2 AND enabled=true AND (stock IS NULL OR stock > 0)
         RETURNING id`,
        [item.id,guildId]
      );
      if (!itemRow.rows[0]) return false;

      await client.query(
        "UPDATE economy_accounts SET balance=balance-$3,updated_at=now() WHERE guild_id=$1 AND user_id=$2",
        [guildId,userId,item.price]
      );
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'purchase',$3,$4::jsonb)",
        [guildId,userId,-item.price,JSON.stringify({ itemId:item.id })]
      );
      return true;
    });
  }

  private async transfer(guildId: string, from: string, to: string, amount: number): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const ids = [from,to].sort();
      for (const id of ids) {
        await client.query(
          `INSERT INTO economy_accounts(guild_id,user_id,balance)
           VALUES($1,$2,0) ON CONFLICT(guild_id,user_id) DO NOTHING`,
          [guildId,id]
        );
      }

      const sender = await client.query<{ balance: number }>(
        "SELECT balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId,from]
      );
      if ((sender.rows[0]?.balance ?? 0) < amount) return false;

      await client.query(
        "UPDATE economy_accounts SET balance=balance-$3,updated_at=now() WHERE guild_id=$1 AND user_id=$2",
        [guildId,from,amount]
      );
      await client.query(
        "UPDATE economy_accounts SET balance=balance+$3,updated_at=now() WHERE guild_id=$1 AND user_id=$2",
        [guildId,to,amount]
      );
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'transfer-out',$3,$4::jsonb)",
        [guildId,from,-amount,JSON.stringify({ to })]
      );
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'transfer-in',$3,$4::jsonb)",
        [guildId,to,amount,JSON.stringify({ from })]
      );
      return true;
    });
  }

  private async recordTransaction(guildId: string, userId: string, type: string, amount: number): Promise<void> {
    await this.db.query(
      "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,$3,$4,'{}'::jsonb)",
      [guildId,userId,type,amount]
    );
  }
}
