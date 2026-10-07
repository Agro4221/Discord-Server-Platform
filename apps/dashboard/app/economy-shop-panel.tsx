"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; manageable?: boolean };

type ShopItem = {
  id: number;
  name: string;
  description: string;
  price: string;
  roleId: string | null;
  stock: number | null;
  enabled: boolean;
};

type EconomyAccount = {
  userId: string;
  balance: string;
  displayName: string;
};

type Draft = {
  name: string;
  description: string;
  price: string;
  roleId: string;
  stock: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  price: "100",
  roleId: "",
  stock: "",
  enabled: true
};

export function EconomyShopPanel({
  guildId,
  roles,
  onChanged
}: {
  guildId: string;
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [accounts, setAccounts] = useState<EconomyAccount[]>([]);
  const [accountUserId, setAccountUserId] = useState("");
  const [accountBalance, setAccountBalance] = useState("0");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!guildId) return;
    const [itemsResponse, accountsResponse] = await Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/economy/items", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/economy/accounts", { cache: "no-store" })
    ]);
    const itemsBody = await itemsResponse.json().catch(() => ({}));
    const accountsBody = await accountsResponse.json().catch(() => ({}));
    if (!itemsResponse.ok) throw new Error(String(itemsBody.error ?? "economy_items_failed"));
    if (!accountsResponse.ok) throw new Error(String(accountsBody.error ?? "economy_accounts_failed"));
    setItems((itemsBody.items ?? []) as ShopItem[]);
    setAccounts((accountsBody.accounts ?? []) as EconomyAccount[]);
  }

  function editAccount(account: EconomyAccount) {
    setAccountUserId(account.userId);
    setAccountBalance(account.balance);
    setError("");
  }

  async function saveAccount() {
    const userId = accountUserId.trim();
    const balance = accountBalance.trim();
    if (!/^\d{15,25}$/.test(userId)) {
      setError("Укажи корректный Discord ID пользователя.");
      return;
    }
    if (!/^\d+$/.test(balance)) {
      setError("Баланс должен быть целым неотрицательным числом.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/economy/accounts/" + encodeURIComponent(userId),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ balance })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "economy_balance_update_failed"));
      await load();
      setAccountBalance(String(body.balance ?? balance));
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить баланс.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setError("");
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    void load().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить магазин.");
    });
  }, [guildId]);

  function startEdit(item: ShopItem) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      description: item.description,
      price: item.price,
      roleId: item.roleId ?? "",
      stock: item.stock === null ? "" : String(item.stock),
      enabled: item.enabled
    });
    setError("");
  }

  function resetEditor() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError("");
  }

  async function save() {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const price = Number(draft.price);
    const stock = draft.stock.trim() === "" ? null : Number(draft.stock);

    if (!name) {
      setError("Укажи название товара.");
      return;
    }
    if (!Number.isSafeInteger(price) || price < 1) {
      setError("Цена должна быть целым числом больше 0.");
      return;
    }
    if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0)) {
      setError("Stock должен быть целым числом 0 или больше.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const path = "/api/guilds/" + encodeURIComponent(guildId) + "/economy/items" +
        (editingId === null ? "" : "/" + editingId);
      const response = await fetch(path, {
        method: editingId === null ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          price,
          roleId: draft.roleId || null,
          stock,
          enabled: draft.enabled
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "economy_item_save_failed"));
      setItems((body.items ?? []) as ShopItem[]);
      resetEditor();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить товар.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ShopItem) {
    if (!window.confirm("Удалить товар #" + item.id + " «" + item.name + "»?")) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/economy/items/" + item.id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "economy_item_delete_failed"));
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (editingId === item.id) resetEditor();
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить товар.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Управление магазином и серверной экономикой. Изменение балансов доступно только из защищённой панели управления.
      </div>

      <section style={sectionBox}>
        <div style={label}>БАЛАНСЫ УЧАСТНИКОВ</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) 180px auto", gap: 8, marginTop: 9 }}>
          <input
            value={accountUserId}
            onChange={(event) => setAccountUserId(event.target.value)}
            inputMode="numeric"
            placeholder="Discord ID пользователя"
            style={inputStyle}
          />
          <input
            value={accountBalance}
            onChange={(event) => setAccountBalance(event.target.value)}
            inputMode="numeric"
            type="number"
            min={0}
            placeholder="Новый баланс"
            style={inputStyle}
          />
          <button type="button" disabled={busy} onClick={() => void saveAccount()} style={button("primary")}>Установить</button>
        </div>

        <div style={{ display: "grid", gap: 1, marginTop: 10 }}>
          {accounts.map((account) => (
            <div key={account.userId} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#dce2ea", fontSize: 11 }}>{account.displayName}</div>
                <div style={{ marginTop: 3, color: "#667284", fontSize: 9 }}>{account.userId}</div>
              </div>
              <strong style={{ marginLeft: "auto", color: "#e7ebf2" }}>{account.balance} coins</strong>
              <button type="button" disabled={busy} onClick={() => editAccount(account)} style={button("secondary")}>Изменить</button>
            </div>
          ))}
          {accounts.length === 0 && <div style={muted}>Счетов пока нет.</div>}
        </div>
      </section>

      {error && (
        <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 }}>
          {error}
        </div>
      )}

      <div style={{ padding: 14, borderRadius: 14, border: "1px solid #222a35", background: "#0d1219" }}>
        <div style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) 120px 120px 180px", gap: 8 }}>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Название товара"
              maxLength={100}
              style={inputStyle}
            />
            <input
              value={draft.price}
              onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
              inputMode="numeric"
              type="number"
              min={1}
              max={2000000000}
              placeholder="Цена"
              style={inputStyle}
            />
            <input
              value={draft.stock}
              onChange={(event) => setDraft((current) => ({ ...current, stock: event.target.value }))}
              inputMode="numeric"
              type="number"
              min={0}
              max={1000000}
              placeholder="Stock ∞"
              style={inputStyle}
            />
            <select
              value={draft.roleId}
              onChange={(event) => setDraft((current) => ({ ...current, roleId: event.target.value }))}
              style={inputStyle}
            >
              <option value="">Без роли</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            maxLength={1000}
            rows={3}
            placeholder="Описание товара"
            style={{ ...inputStyle, resize: "vertical" as const }}
          />

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 7, alignItems: "center", color: "#9da7b6", fontSize: 11 }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Показывать в магазине
            </label>
            <div style={{ flex: 1 }} />
            {editingId !== null && (
              <button type="button" disabled={busy} onClick={resetEditor} style={button("secondary")}>
                Отмена
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void save()} style={button("primary")}>
              {busy ? "Сохраняем…" : editingId === null ? "Добавить товар" : "Сохранить товар"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px,1fr) 110px 110px minmax(160px,220px) auto",
              gap: 10,
              alignItems: "center",
              padding: "11px 0",
              borderBottom: "1px solid #1d232d",
              opacity: item.enabled ? 1 : 0.58
            }}
          >
            <div>
              <div style={{ fontWeight: 650 }}>
                #{item.id} · {item.name}
                {!item.enabled && <span style={{ marginLeft: 7, fontSize: 9, color: "#7f8998" }}>Выключено</span>}
              </div>
              <div style={{ marginTop: 4, color: "#687386", fontSize: 10, lineHeight: 1.45 }}>
                {item.description || "Без описания"}
              </div>
              {item.roleId && (
                <div style={{ marginTop: 4, color: "#8390a3", fontSize: 10 }}>
                  Роль: @{roles.find((role) => role.id === item.roleId)?.name ?? item.roleId}
                </div>
              )}
            </div>
            <div style={{ color: "#d7ddea", fontSize: 12 }}>{item.price} coins</div>
            <div style={{ color: "#9da8b8", fontSize: 11 }}>{item.stock === null ? "∞" : String(item.stock)} шт.</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button type="button" disabled={busy} onClick={() => startEdit(item)} style={button("secondary")}>Изменить</button>
              <button type="button" disabled={busy} onClick={() => void remove(item)} style={button("danger")}>Удалить</button>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div style={{ padding: 12, color: "#677285", fontSize: 11 }}>
            Магазин пока пуст. Создай первый товар выше.
          </div>
        )}
      </div>
    </div>
  );
}

const sectionBox = { padding: 14, borderRadius: 14, border: "1px solid #222a35", background: "#0d1219" } as const;
const rowStyle = { display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px solid #1d232d" } as const;
const label = { color: "#687486", fontSize: 9, letterSpacing: 1.2 } as const;
const muted = { color: "#687386", fontSize: 10 } as const;

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  border: "1px solid #29313e",
  borderRadius: 9,
  padding: "9px 10px",
  color: "#f1f5f9"
};

const button = (kind: "primary" | "secondary" | "danger") => ({
  border: "1px solid " + (kind === "danger" ? "#79343c" : "#303846"),
  background: kind === "danger" ? "#4b2227" : kind === "primary" ? "#253c5e" : "#171c25",
  color: "#f5f7fa",
  borderRadius: 9,
  padding: "9px 12px",
  cursor: "pointer"
} as const);
