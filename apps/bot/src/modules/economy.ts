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
  price: bigint;
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
    if (!["economy","shop"].includes(interaction.commandName)) return;
    const guildId = interaction.guild!.id;
    if (!await moduleEnabled(this.db, guildId, "economy", false)) {
      await interaction.reply({ content: "Модуль Economy выключен.", ephemeral: true });
      return;
    }
    if (interaction.commandName === "economy") await this.economyCommand(interaction);
    else await this.shopCommand(interaction);
  }

  private async economyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const sub = interaction.options.getSubcommand();
    if (sub === "balance") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const balance = await this.balance(guildId, user.id);
      await interaction.reply({ content: `💰 ${user}: **${balance.toString()}** coins.`, ephemeral: true });
      return;
    }
    if (sub === "daily") {
      const result = await this.claimDaily(guildId, interaction.user.id);
      if (result === null) {
        await interaction.reply({ content: "Daily уже забран. Возвращайся позже.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: `🎁 Получено **100** coins. Баланс: **${result.toString()}**.`, ephemeral: true });
      return;
    }
    if (sub === "pay") {
      const target = interaction.options.getUser("user", true);
      const amountNumber = interaction.options.getInteger("amount", true);
      if (target.bot || target.id === interaction.user.id || amountNumber <= 0) {
        await interaction.reply({ content: "Некорректный получатель или сумма.", ephemeral: true });
        return;
      }
      const moved = await this.transfer(guildId, interaction.user.id, target.id, BigInt(amountNumber));
      await interaction.reply({
        content: moved ? `💸 Переведено **${amountNumber}** coins пользователю ${target}.` : "Недостаточно средств.",
        ephemeral: true
      });
      return;
    }
    if (sub === "leaderboard") {
      const result = await this.db.query<{ user_id: string; balance: string }>(
        "SELECT user_id,balance::text AS balance FROM economy_accounts WHERE guild_id=$1 ORDER BY balance DESC LIMIT 10",
        [guildId]
      );
      const lines = result.rows.map((row,index) => `${index+1}. <@${row.user_id}> · ${row.balance} coins`);
      await interaction.reply({ content: lines.length ? `🏦 **Экономика**\n${lines.join("\n")}` : "Балансов пока нет.", ephemeral: true });
    }
  }

  private async shopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const items = await this.items(guildId);
      if (!items.length) { await interaction.reply({ content: "Магазин пуст.", ephemeral: true }); return; }
      const embed = new EmbedBuilder().setTitle("🛒 Магазин").setDescription(
        items.map((item) => `${item.id}. ${item.name} — ${item.price.toString()} coins\n${item.description}${item.stock === null ? "" : `\nОстаток: ${item.stock}`}`).join("\n\n")
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
      const price = BigInt(interaction.options.getInteger("price", true));
      if (role && role.position >= (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
        await interaction.reply({ content: "Бот не может управлять этой ролью из-за role hierarchy.", ephemeral: true });
        return;
      }
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO economy_shop_items(guild_id,name,description,price,role_id,stock)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [guildId, interaction.options.getString("name", true), interaction.options.getString("description", true), price.toString(), role?.id ?? null, interaction.options.getInteger("stock")]
      );
      await interaction.reply({ content: `Товар #${result.rows[0]?.id ?? "?"} создан.`, ephemeral: true });
      return;
    }
    if (sub === "buy") {
      const itemId = interaction.options.getInteger("item", true);
      const item = (await this.items(guildId)).find((candidate) => candidate.id === itemId);
      if (!item) { await interaction.reply({ content: "Товар не найден.", ephemeral: true }); return; }
      const bought = await this.purchase(guildId, interaction.user.id, item);
      if (!bought) { await interaction.reply({ content: "Не хватает coins или товар закончился.", ephemeral: true }); return; }
      if (item.roleId) {
        const role = interaction.guild!.roles.cache.get(item.roleId);
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        if (role && member.manageable && role.position < (interaction.guild!.members.me?.roles.highest.position ?? 0)) {
          await member.roles.add(role, "Economy shop purchase").catch(() => undefined);
        }
      }
      await interaction.reply({ content: `✅ Куплено: **${item.name}** за ${item.price.toString()} coins.`, ephemeral: true });
    }
  }

  private async balance(guildId: string, userId: string): Promise<bigint> {
    const result = await this.db.query<{ balance: string }>(
      "SELECT balance::text AS balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2",
      [guildId,userId]
    );
    return result.rows[0] ? BigInt(result.rows[0].balance) : 0n;
  }

  private async claimDaily(guildId: string, userId: string): Promise<bigint | null> {
    return this.db.transaction(async (client) => {
      const result = await client.query<{ balance: string }>(
        `INSERT INTO economy_accounts(guild_id,user_id,balance,last_daily)
         VALUES($1,$2,100,now())
         ON CONFLICT(guild_id,user_id) DO UPDATE SET
           balance=economy_accounts.balance+100,last_daily=now(),updated_at=now()
         WHERE economy_accounts.last_daily IS NULL OR economy_accounts.last_daily < now()-interval '23 hours'
         RETURNING balance::text AS balance`,
        [guildId,userId]
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'daily',100,'{}'::jsonb)",
        [guildId,userId]
      );
      return BigInt(row.balance);
    });
  }

  private async items(guildId: string): Promise<ShopItem[]> {
    const result = await this.db.query<{ id: string; name: string; description: string; price: string; role_id: string | null; stock: number | null }>(
      "SELECT id,name,description,price::text AS price,role_id,stock FROM economy_shop_items WHERE guild_id=$1 AND enabled=true ORDER BY id",
      [guildId]
    );
    return result.rows.map((row) => ({ id:Number(row.id), name:row.name, description:row.description, price:BigInt(row.price), roleId:row.role_id, stock:row.stock }));
  }

  private async purchase(guildId: string, userId: string, item: ShopItem): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const account = await client.query<{ balance: string }>(
        "SELECT balance::text AS balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId,userId]
      );
      const balance = account.rows[0] ? BigInt(account.rows[0].balance) : 0n;
      if (balance < item.price) return false;
      const itemRow = await client.query<{ id: string }>(
        `UPDATE economy_shop_items SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-1 END,updated_at=now()
         WHERE id=$1 AND guild_id=$2 AND enabled=true AND (stock IS NULL OR stock > 0) RETURNING id`,
        [item.id,guildId]
      );
      if (!itemRow.rows[0]) return false;
      await client.query(
        "UPDATE economy_accounts SET balance=balance-$3::bigint,updated_at=now() WHERE guild_id=$1 AND user_id=$2",
        [guildId,userId,item.price.toString()]
      );
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'purchase',$3,$4::jsonb)",
        [guildId,userId,"-" + item.price.toString(),JSON.stringify({itemId:item.id})]
      );
      return true;
    });
  }

  private async transfer(guildId: string, from: string, to: string, amount: bigint): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const ids = [from,to].sort();
      for (const id of ids) {
        await client.query("INSERT INTO economy_accounts(guild_id,user_id,balance) VALUES($1,$2,0) ON CONFLICT(guild_id,user_id) DO NOTHING", [guildId,id]);
      }
      const sender = await client.query<{ balance: string }>(
        "SELECT balance::text AS balance FROM economy_accounts WHERE guild_id=$1 AND user_id=$2 FOR UPDATE",
        [guildId,from]
      );
      if (!sender.rows[0] || BigInt(sender.rows[0].balance) < amount) return false;
      await client.query("UPDATE economy_accounts SET balance=balance-$3::bigint,updated_at=now() WHERE guild_id=$1 AND user_id=$2", [guildId,from,amount.toString()]);
      await client.query("UPDATE economy_accounts SET balance=balance+$3::bigint,updated_at=now() WHERE guild_id=$1 AND user_id=$2", [guildId,to,amount.toString()]);
      await client.query("INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'transfer-out',$3,$4::jsonb)", [guildId,from,"-" + amount.toString(),JSON.stringify({to})]);
      await client.query("INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'transfer-in',$3,$4::jsonb)", [guildId,to,amount.toString(),JSON.stringify({from})]);
      return true;
    });
  }
}
