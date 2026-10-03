"use client";

import { useEffect, useMemo, useState } from "react";

type Resource = { id: string; name: string; manageable?: boolean };
type Command = {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  actionType: "response" | "alias" | "add_role" | "remove_role" | "toggle_role";
  response: string;
  aliasTarget: string | null;
  allowedRoleIds: string[];
  allowedChannelIds: string[];
  cooldownSeconds: number;
  roleId: string | null;
};

const ACTIONS = [
  ["response", "Ответить текстом"],
  ["alias", "Alias встроенной команды"],
  ["add_role", "Выдать роль"],
  ["remove_role", "Снять роль"],
  ["toggle_role", "Переключить роль"]
] as const;

const EMPTY: Omit<Command, "id"> = {
  name: "",
  aliases: [],
  description: "",
  enabled: true,
  prefixEnabled: true,
  slashEnabled: true,
  actionType: "response",
  response: "",
  aliasTarget: null,
  allowedRoleIds: [],
  allowedChannelIds: [],
  cooldownSeconds: 0,
  roleId: null
};

export function CustomCommandsPanel(props: {
  guildId: string;
  roles: Resource[];
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Command[]>([]);
  const [draft, setDraft] = useState<Command | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "custom_commands_failed");
    setItems((body.commands ?? []) as Command[]);
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить команды."));
  }, [props.guildId]);

  const roleMap = useMemo(() => new Map(props.roles.map((role) => [role.id, role.name])), [props.roles]);

  function edit(item: Command) {
    setDraft({
      ...item,
      aliases: [...item.aliases],
      allowedRoleIds: [...item.allowedRoleIds],
      allowedChannelIds: [...item.allowedChannelIds]
    });
  }

  function patch(patch: Partial<Command>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setStatus("");
    try {
      const path = "/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands" + (draft.id ? "/" + draft.id : "");
      const response = await fetch(path, {
        method: draft.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          aliases: draft.aliases,
          description: draft.description,
          enabled: draft.enabled,
          prefixEnabled: draft.prefixEnabled,
          slashEnabled: draft.slashEnabled,
          actionType: draft.actionType,
          response: draft.response,
          aliasTarget: draft.aliasTarget,
          allowedRoleIds: draft.allowedRoleIds,
          allowedChannelIds: draft.allowedChannelIds,
          cooldownSeconds: draft.cooldownSeconds,
          roleId: draft.roleId
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "custom_command_save_failed");
      setItems((body.commands ?? []) as Command[]);
      setDraft(null);
      setStatus("Команда сохранена.");
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить команду.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Command) {
    if (!window.confirm("Удалить /" + item.name + "?")) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/custom-commands/" + item.id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "custom_command_delete_failed");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (draft?.id === item.id) setDraft(null);
      setStatus("Команда удалена.");
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить команду.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 11 }}>
      {status && <div style={notice}>{status}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <span style={{ color: "#697486", fontSize: 10 }}>Prefix + Slash команды, aliases, ответы, role actions и cooldown.</span>
        <button type="button" onClick={() => setDraft({ id: 0, ...EMPTY })} disabled={busy} style={primary}>＋ Новая команда</button>
      </div>

      {items.map((item) => (
        <div key={item.id} style={card}>
          <div>
            <strong style={{ fontSize: 12 }}>/{item.name}</strong>
            {item.description && <div style={{ color: "#697486", fontSize: 9, marginTop: 3 }}>{item.description}</div>}
            <div style={{ color: "#596474", fontSize: 8, marginTop: 4 }}>
              {item.actionType} · {item.prefixEnabled ? "prefix" : ""}{item.prefixEnabled && item.slashEnabled ? " + " : ""}{item.slashEnabled ? "slash" : ""}
              {item.cooldownSeconds ? " · cooldown " + item.cooldownSeconds + "s" : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={pill(item.enabled)}>{item.enabled ? "ON" : "OFF"}</span>
            <button type="button" onClick={() => edit(item)} disabled={busy} style={secondary}>Изменить</button>
            <button type="button" onClick={() => void remove(item)} disabled={busy} style={danger}>Удалить</button>
          </div>
        </div>
      ))}

      {!items.length && <div style={empty}>Custom Commands пока не созданы.</div>}

      {draft && (
        <section style={editor}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 }}>
            <label style={field}><span>Имя</span><input value={draft.name} maxLength={32} onChange={(e) => patch({ name: e.target.value })} style={input} placeholder="server-info" /></label>
            <label style={field}><span>Описание</span><input value={draft.description} maxLength={100} onChange={(e) => patch({ description: e.target.value })} style={input} /></label>
            <label style={field}><span>Aliases через пробел</span><input value={draft.aliases.join(" ")} onChange={(e) => patch({ aliases: e.target.value.split(/[\s,]+/).filter(Boolean) })} style={input} /></label>
            <label style={field}><span>Cooldown, сек.</span><input type="number" min={0} max={86400} value={draft.cooldownSeconds} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} style={input} /></label>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label style={check}><input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Включена</label>
            <label style={check}><input type="checkbox" checked={draft.prefixEnabled} onChange={(e) => patch({ prefixEnabled: e.target.checked })} /> Prefix</label>
            <label style={check}><input type="checkbox" checked={draft.slashEnabled} onChange={(e) => patch({ slashEnabled: e.target.checked })} /> Slash</label>
          </div>

          <label style={field}><span>Действие</span>
            <select value={draft.actionType} onChange={(e) => patch({ actionType: e.target.value as Command["actionType"] })} style={input}>
              {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>

          {draft.actionType === "response" && (
            <label style={field}>
              <span>Ответ</span>
              <textarea value={draft.response} maxLength={2000} onChange={(e) => patch({ response: e.target.value })} style={{ ...input, minHeight: 100 }} placeholder="Привет, {mention}! Сервер: {server}. Аргументы: {args}" />
              <small style={{ color: "#5f6978", fontSize: 8 }}>Переменные: {"{user}"} {"{mention}"} {"{server}"} {"{channel}"} {"{args}"}.</small>
            </label>
          )}

          {draft.actionType === "alias" && (
            <label style={field}><span>Целевая команда</span><input value={draft.aliasTarget ?? ""} maxLength={32} onChange={(e) => patch({ aliasTarget: e.target.value })} style={input} placeholder="rank" /></label>
          )}

          {["add_role","remove_role","toggle_role"].includes(draft.actionType) && (
            <label style={field}><span>Роль</span>
              <select value={draft.roleId ?? ""} onChange={(e) => patch({ roleId: e.target.value || null })} style={input}>
                <option value="">Выбери роль…</option>
                {props.roles.filter((role) => role.manageable !== false).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              {draft.roleId && <small style={{ color: "#5f6978", fontSize: 8 }}>Выбрано: {roleMap.get(draft.roleId) ?? draft.roleId}</small>}
            </label>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} style={secondary}>Отмена</button>
            <button type="button" onClick={() => void save()} disabled={busy} style={primary}>{busy ? "Сохранение…" : "Сохранить"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

const card = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12, borderRadius: 11, border: "1px solid #232a35", background: "#0d1219" } as const;
const editor = { display: "grid", gap: 11, padding: 14, borderRadius: 12, border: "1px solid #2d3947", background: "#0b1017" } as const;
const field = { display: "grid", gap: 5, color: "#8d98a8", fontSize: 9 } as const;
const check = { display: "flex", gap: 6, alignItems: "center", color: "#8d98a8", fontSize: 9 } as const;
const input = { width: "100%", boxSizing: "border-box" as const, background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px" } as const;
const primary = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 11px", cursor: "pointer" } as const;
const secondary = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const danger = { ...secondary, border: "1px solid #5d3035", color: "#efacac" } as const;
const notice = { padding: "9px 11px", borderRadius: 9, background: "#171d27", border: "1px solid #2b3543", color: "#9ba6b6", fontSize: 10 } as const;
const empty = { padding: "18px 10px", textAlign: "center" as const, color: "#5f6978", fontSize: 10, border: "1px dashed #29313d", borderRadius: 10 } as const;
const pill = (active: boolean) => ({ padding: "5px 7px", borderRadius: 99, background: active ? "#173522" : "#1b2028", color: active ? "#82d99f" : "#838d9c", fontSize: 8 }) as const;
