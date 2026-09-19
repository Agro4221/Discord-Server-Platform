import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

export class EconomyShop implements PlatformModule {
  readonly name = "economy";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => a();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "shop") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "economy", false)) {
      await interaction.reply({ content: "Модуль Economy выключен.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const items = await this.items(interaction.guild.id);
      if (!items.length) {
        await interaction.reply({ content: "Магазин пуст.", ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🛒 Магазин")
        .setDescription(
          items
            .map((item) =>
              `**#${item.id} ${item.name}** — ${item.price} coins\n${item.description}${
                item.stock === null ? "" : `\nОстаток: ${item.stock}`
              }`
            )
            .join("\n\n")
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "buy") {
      const itemId = interaction.options.getInteger("item", true);
      const item = (await this.items(interaction.guild.id)).find((candidate) => candidate.id === itemId);
      if (!item) {
        await interaction.reply({ content: "Товар не найден.", ephemeral: true });
        return;
      }

      const bought = await this.purchase(interaction.guild.id, interaction.user.id, item);
      await interaction.reply({
        content: bought ? `✅ Куплено: **${item.name}** за ${item.price} coins.` : "Не хватает coins или товар закончился.",
        ephemeral: true
      });

      if (bought && item.roleId) {
        const role = interaction.guild.roles.cache.get(item.roleId);
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (role && member.manageable && role.position < (interaction.guild.members.me?.roles.highest.position ?? 0)) {
          await member.roles.add(role, "Economy shop purchase").catch(() => undefined);
        }
      }
      return;
    }

    if (sub === "create") {
      if (!interaction.memberPermissions?.has("ManageGuild")) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }

      const role = interaction.options.getRole("role");
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO economy_shop_items(guild_id,name,description,price,role_id,stock)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          interaction.guild.id,
          interaction.options.getString("name", true),
          interaction.options.getString("description", true),
          interaction.options.getInteger("price", true),
          role?.id ?? null,
          interaction.options.getInteger("stock")
        ]
      );
      await interaction.reply({ content: `Товар #${result.rows[0]?.id ?? "?"} создан.`, ephemeral: true });
    }
  }

  private async items(guildId: string): Promise<ShopItem[]> {
    const result = await this.db.query<{
      id: string;
      name: string;
      description: string;
      price: number;
      role_id: string | null;
      stock: number | null;
    }>(
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
        [guildId, userId]
      );
      const balance = account.rows[0]?.balance ?? 0;
      if (balance < item.price) return false;

      const itemRow = await client.query<{ id: string }>(
        `UPDATE economy_shop_items
         SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-1 END,updated_at=now()
         WHERE id=$1 AND guild_id=$2 AND enabled=true AND (stock IS NULL OR stock > 0)
         RETURNING id`,
        [item.id, guildId]
      );
      if (!itemRow.rows[0]) return false;

      await client.query(
        "UPDATE economy_accounts SET balance=balance-$3,updated_at=now() WHERE guild_id=$1 AND user_id=$2",
        [guildId, userId, item.price]
      );
      await client.query(
        "INSERT INTO economy_transactions(guild_id,user_id,type,amount,metadata) VALUES($1,$2,'purchase',$3,$4::jsonb)",
        [guildId, userId, -item.price, JSON.stringify({ itemId: item.id })]
      );
      return true;
    });
  }
}
