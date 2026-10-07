"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };
type PanelRole = { roleId: string; label: string };
type RolePanel = { id: number; guildId: string; channelId: string; messageId: string | null; title: string; roles: PanelRole[] };

export function RolePanelsEditor({
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
  const [panels, setPanels] = useState<RolePanel[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("Выберите роли");
  const [channelId, setChannelId] = useState("");
  const [panelRoles, setPanelRoles] = useState<PanelRole[]>([{ roleId: "", label: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/role-panels", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "role_panels_failed");
    setPanels(body.panels ?? []);
  }

  useEffect(() => {
    setEditingId(null);
    setTitle("Выберите роли");
    setChannelId("");
    setPanelRoles([{ roleId: "", label: "" }]);
    void load().catch(() => setError("Не удалось загрузить панели ролей."));
    // guildId is the resource boundary for this editor.
  }, [guildId]);

  function updateRole(index: number, patch: Partial<PanelRole>) {
    setPanelRoles((current) => current.map((role, i) => i === index ? { ...role, ...patch } : role));
  }

  function reset() {
    setEditingId(null);
    setTitle("Выберите роли");
    setChannelId("");
    setPanelRoles([{ roleId: "", label: "" }]);
    setError("");
  }

  function edit(panel: RolePanel) {
    setEditingId(panel.id);
    setTitle(panel.title);
    setChannelId(panel.channelId);
    setPanelRoles(panel.roles.length ? panel.roles : [{ roleId: "", label: "" }]);
    setError("");
  }

  async function save() {
    const cleanRoles = panelRoles.map((role) => ({ roleId: role.roleId, label: role.label.trim() })).filter((role) => role.roleId && role.label);
    if (!channelId || cleanRoles.length < 1 || cleanRoles.length > 5) {
      setError("Укажи текстовый канал и от 1 до 5 ролей.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/role-panels" + (editingId === null ? "" : "/" + editingId),
        {
          method: editingId === null ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channelId, title, roles: cleanRoles })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "role_panel_save_failed");
      await load();
      reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить панель.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(panelId: number) {
    if (!window.confirm("Удалить эту панель ролей и её сообщение?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/role-panels/" + panelId, { method: "DELETE" });
      if (!response.ok) throw new Error("role_panel_delete_failed");
      await load();
      if (editingId === panelId) reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить панель.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 18 }}>Панели ролей</h3>
        <div style={{ marginTop: 6, opacity: 0.48, fontSize: 12 }}>Панель публикуется в выбранный текстовый канал и использует кнопки для выдачи/снятия ролей.</div>
      </div>
      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}
      <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Заголовок панели" style={inputStyle} />
      <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
        <option value="">Выберите текстовый канал</option>
        {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
      <div style={{ display: "grid", gap: 9 }}>
        {panelRoles.map((entry, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8 }}>
            <select value={entry.roleId} onChange={(event) => updateRole(index, { roleId: event.target.value, label: entry.label || roles.find((r) => r.id === event.target.value)?.name || "" })} style={inputStyle}>
              <option value="">Выберите роль</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.manageable === false ? " · роль выше бота" : ""}</option>)}
            </select>
            <input value={entry.label} maxLength={80} onChange={(event) => updateRole(index, { label: event.target.value })} placeholder="Текст кнопки" style={inputStyle} />
            <button type="button" disabled={saving || panelRoles.length === 1} onClick={() => setPanelRoles((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving || panelRoles.length >= 5} onClick={() => setPanelRoles((current) => current.length >= 5 ? current : [...current, { roleId: "", label: "" }])} style={buttonStyle("secondary")}>+ Роль</button>
        <button type="button" disabled={saving} onClick={() => void save()} style={buttonStyle("primary")}>{editingId === null ? "Создать панель" : "Сохранить изменения"}</button>
        {editingId !== null && <button type="button" disabled={saving} onClick={reset} style={buttonStyle("secondary")}>Отмена</button>}
      </div>
      <div style={{ borderTop: "1px solid #202530", paddingTop: 16, display: "grid", gap: 8 }}>
        <h4 style={{ margin: 0 }}>Опубликованные панели</h4>
        {panels.length === 0 ? <div style={{ opacity: 0.42 }}>Панелей пока нет.</div> : panels.map((panel) => (
          <div key={panel.id} style={{ padding: "11px 0", borderBottom: "1px solid #1d212b", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div>{panel.title}</div>
              <div style={{ opacity: 0.42, fontSize: 11 }}>{panel.roles.length} ролей · канал {panel.channelId}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" disabled={saving} onClick={() => edit(panel)} style={buttonStyle("secondary")}>Изменить</button>
              <button type="button" disabled={saving} onClick={() => void remove(panel.id)} style={buttonStyle("danger")}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 10,
  padding: "11px 12px"
} as const;

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643";
  return { border: "1px solid " + border, background, color: "#fff", borderRadius: 10, padding: "10px 13px", cursor: "pointer" } as const;
}