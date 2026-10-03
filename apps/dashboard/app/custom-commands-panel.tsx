"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; manageable?: boolean };
type ActionType = "response" | "alias" | "add_role" | "remove_role" | "toggle_role";
type Command = {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  actionType: ActionType;
  response: string;
  aliasTarget: string | null;
  allowedRoleIds: string[];
  allowedChannelIds: string[];
  cooldownSeconds: number;
  roleId: string | null;
};

const ACTION_LABELS: Record<ActionType, string> = {
  response: "Ответ",
  alias: "Alias",
  add_role: "Выдать роль",
  remove_role: "Снять роль",
  toggle_role: "Toggle роли"
};

const DEFAULT_FORM = {
  name: "",
  aliases: "",
  description: "",
  enabled: true,
  prefixEnabled: true,
  slashEnabled: false,
  actionType: "response" as ActionType,
  response: "",
  aliasTarget: "",
  roleId: "",
  allowedRoleIds: [] as string[],
  allowedChannelIds: [] as string[],
  cooldownSeconds: 0
};

type Form = typeof DEFAULT_FORM;

export function CustomCommandsPanel({
  guildId,
  channels,
  roles,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [form, setForm] = useState<Form>({ ...DEFAULT_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/custom-commands", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "custom_commands_failed");
    setCommands(Array.isArray(body.commands) ? body.commands : []);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить Custom Commands."));
  }, [guildId]);

  function reset() {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM });
    setError("");
  }

  function edit(command: Command) {
    setEditingId(command.id);
    setForm({
      name: command.name,
      aliases: command.aliases.join(", "),
      description: command.description,
      enabled: command.enabled,
      prefixEnabled: command.prefixEnabled,
      slashEnabled: command.slashEnabled,
      actionType: command.actionType,
      response: command.response,
      aliasTarget: command.aliasTarget ?? "",
      roleId: command.roleId ?? "",
      allowedRoleIds: [...command.allowedRoleIds],
      allowedChannelIds: [...command.allowedChannelIds],
      cooldownSeconds: command.cooldownSeconds
    });
    setError("");
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Укажи имя команды.");
      return;
    }
    if (!form.prefixEnabled && !form.slashEnabled) {
      setError("Включи хотя бы prefix или slash.");
      return;
    }
    if (form.actionType === "response" && !form.response.trim()) {
      setError("Для ответа нужен текст.");
      return;
    }
    if (form.actionType === "alias" && !form.aliasTarget.trim()) {
      setError("Для alias нужна целевая команда.");
      return;
    }
    if (form.actionType !== "response" && form.actionType !== "alias" && !form.roleId) {
      setError("Выбери роль.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        aliases: form.aliases.split(/[,
]/).map((item) => item.trim()).filter(Boolean),
        description: form.description.trim(),
        enabled: form.enabled,
        prefixEnabled: form.prefixEnabled,
        slashEnabled: form.slashEnabled,
        actionType: form.actionType,
        response: form.response,
        aliasTarget: form.aliasTarget.trim() || null,
        roleId: form.roleId || null,
        allowedRoleIds: form.allowedRoleIds,
        allowedChannelIds: form.allowedChannelIds,
        cooldownSeconds: Number(form.cooldownSeconds)
      };

      const url = "/api/guilds/" + encodeURIComponent(guildId) + "/custom-commands" +
        (editingId === null ? "" : "/" + editingId);
      const response = await fetch(url, {
        method: editingId === null ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "custom_command_save_failed");

      await load();
      reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить команду.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить эту custom command?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/custom-commands/" + id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "custom_command_delete_failed");
      await load();
      if (editingId === id) reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить команду.");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={errorStyle}>{error}</div>}

      <div style={formGrid}>
        <label style={labelStyle}>
          Имя
          <input value={form.name} maxLength={32} onChange={(e) => patch("name", e.target.value)} style={inputStyle} placeholder="rules" />
        </label>
        <label style={labelStyle}>
          Aliases
          <input value={form.aliases} maxLength={320} onChange={(e) => patch("aliases", e.target.value)} style={inputStyle} placeholder="правила, rules2" />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Описание
          <input value={form.description} maxLength={100} onChange={(e) => patch("description", e.target.value)} style={inputStyle} placeholder="Короткое описание команды" />
        </label>
      </div>

      <div style={toolbar}>
        <label><input type="checkbox" checked={form.enabled} onChange={(e) => patch("enabled", e.target.checked)} /> Включена</label>
        <label><input type="checkbox" checked={form.prefixEnabled} onChange={(e) => patch("prefixEnabled", e.target.checked)} /> Prefix</label>
        <label><input type="checkbox" checked={form.slashEnabled} onChange={(e) => patch("slashEnabled", e.target.checked)} /> Slash</label>
        <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
          Cooldown
          <input type="number" min={0} max={86400} value={form.cooldownSeconds} onChange={(e) => patch("cooldownSeconds", Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
        </label>
      </div>

      <label style={labelStyle}>
        Тип действия
        <select value={form.actionType} onChange={(e) => patch("actionType", e.target.value as ActionType)} style={inputStyle}>
          {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      {form.actionType === "response" && (
        <label style={labelStyle}>
          Ответ
          <textarea value={form.response} maxLength={2000} rows={5} onChange={(e) => patch("response", e.target.value)} style={textAreaStyle} placeholder="{mention}, привет! {args}" />
        </label>
      )}

      {form.actionType === "alias" && (
        <label style={labelStyle}>
          Целевая команда
          <input value={form.aliasTarget} maxLength={100} onChange={(e) => patch("aliasTarget", e.target.value)} style={inputStyle} placeholder="help или ban" />
        </label>
      )}

      {form.actionType !== "response" && form.actionType !== "alias" && (
        <label style={labelStyle}>
          Роль
          <select value={form.roleId} onChange={(e) => patch("roleId", e.target.value)} style={inputStyle}>
            <option value="">Выбери роль</option>
            {roles.filter((role) => role.manageable !== false).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
      )}

      <div style={selectGrid}>
        <label style={labelStyle}>
          Разрешённые роли
          <select multiple value={form.allowedRoleIds} onChange={(e) => patch("allowedRoleIds", [...e.target.selectedOptions].map((option) => option.value))} style={multiSelectStyle}>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Разрешённые каналы
          <select multiple value={form.allowedChannelIds} onChange={(e) => patch("allowedChannelIds", [...e.target.selectedOptions].map((option) => option.value))} style={multiSelectStyle}>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
        </label>
      </div>

      <div style={toolbar}>
        <button type="button" disabled={saving} onClick={() => void save()} style={buttonStyle("primary")}>{editingId === null ? "Создать" : "Сохранить"}</button>
        {editingId !== null && <button type="button" disabled={saving} onClick={reset} style={buttonStyle("secondary")}>Отмена</button>}
      </div>

      <div style={{ display: "grid", gap: 7 }}>
        {commands.length === 0 && <div style={{ opacity: 0.45 }}>Команд пока нет.</div>}
        {commands.map((command) => (
          <div key={command.id} style={itemStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{command.name} {command.enabled ? "· ON" : "· OFF"}</div>
              <div style={{ marginTop: 3, color: "#778394", fontSize: 10 }}>
                {ACTION_LABELS[command.actionType]} · {command.prefixEnabled ? "prefix" : ""}{command.prefixEnabled && command.slashEnabled ? " + " : ""}{command.slashEnabled ? "slash" : ""}
                {command.aliases.length ? " · alias: " + command.aliases.join(", ") : ""}
              </div>
              {command.description && <div style={{ marginTop: 3, color: "#657184", fontSize: 9 }}>{command.description}</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" disabled={saving} onClick={() => edit(command)} style={buttonStyle("secondary")}>Изменить</button>
              <button type="button" disabled={saving} onClick={() => void remove(command.id)} style={buttonStyle("danger")}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle = {
  background: "#0c1016",
  color: "#f4f6fa",
  border: "1px solid #303846",
  borderRadius: 10,
  padding: "9px 10px",
  width: "100%",
  boxSizing: "border-box" as const
};

const textAreaStyle = {
  ...inputStyle,
  resize: "vertical" as const
};

const multiSelectStyle = {
  ...inputStyle,
  minHeight: 132
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 9
} as const;

const selectGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 9
} as const;

const toolbar = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap" as const,
  gap: 12,
  color: "#a1aabb",
  fontSize: 11
};

const labelStyle = {
  display: "grid",
  gap: 5,
  color: "#8f9aab",
  fontSize: 10
};

const errorStyle = {
  padding: 10,
  borderRadius: 10,
  background: "#32191b",
  border: "1px solid #63292d",
  color: "#f0b6ba",
  fontSize: 11
};

const itemStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: 10,
  borderRadius: 10,
  border: "1px solid #232a35",
  background: "#0d1219"
};

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21",
    color: "#fff",
    borderRadius: 9,
    padding: "8px 11px",
    cursor: "pointer"
  } as const;
}
