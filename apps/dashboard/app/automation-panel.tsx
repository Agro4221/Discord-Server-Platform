"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type ConditionRow = { type: "contains" | "equals" | "channel-is"; value: string };
type ActionRow = { type: "send-message" | "log"; channelId: string; text: string };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  all: Array<{ type: string; left?: string; right?: string; channelId?: string }>;
  actions: Array<{ type: string; channelId?: string; content?: string; message?: string }>;
};

const EVENTS = ["member.join","member.leave","message.create","voice.join","voice.leave","voice.move"] as const;

export function AutomationPanel({
  guildId,
  channels,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Новое правило");
  const [event, setEvent] = useState<string>("message.create");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([{ type: "send-message", channelId: "", text: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "automation_failed");
    setRules(body.rules ?? []);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить automation rules."));
  }, [guildId]);

  function reset() {
    setEditingId(null);
    setName("Новое правило");
    setEvent("message.create");
    setCooldownSeconds(0);
    setEnabled(true);
    setConditions([]);
    setActions([{ type: "send-message", channelId: "", text: "" }]);
    setError("");
  }

  function edit(rule: Rule) {
    setEditingId(rule.id);
    setName(rule.name);
    setEvent(rule.event);
    setEnabled(rule.enabled);
    const cooldown = 0;
    setCooldownSeconds(cooldown);
    setConditions(rule.all.map((condition) => {
      if (condition.type === "channel-is") return { type: "channel-is", value: condition.channelId ?? "" };
      if (condition.type === "equals") return { type: "equals", value: condition.right ?? "" };
      return { type: "contains", value: condition.right ?? "" };
    }));
    setActions(rule.actions.map((action) => action.type === "send-message"
      ? { type: "send-message", channelId: action.channelId ?? "", text: action.content ?? "" }
      : { type: "log", channelId: "", text: action.message ?? "" }
    ));
    setError("");
  }

  function buildPayload() {
    return {
      name,
      event,
      cooldownSeconds,
      enabled,
      conditions: conditions.map((condition) =>
        condition.type === "channel-is"
          ? { type: "channel-is", channelId: condition.value }
          : { type: condition.type, left: "content", right: condition.value }
      ),
      actions: actions.map((action) =>
        action.type === "send-message"
          ? { type: "send-message", channelId: action.channelId, content: action.text }
          : { type: "log", message: action.text }
      )
    };
  }

  async function save() {
    if (!name.trim()) {
      setError("Укажи название правила.");
      return;
    }
    if (actions.length < 1 || actions.length > 10) {
      setError("Нужно от 1 до 10 действий.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = "/api/guilds/" + encodeURIComponent(guildId) + "/automation" + (editingId ? "/" + encodeURIComponent(editingId) : "");
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "automation_save_failed");
      await load();
      reset();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить правило.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleId: string) {
    if (!window.confirm("Удалить это automation rule?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/automation/" + encodeURIComponent(ruleId), { method: "DELETE" });
      if (!response.ok) throw new Error("automation_delete_failed");
      await load();
      if (editingId === ruleId) reset();
      await onChanged?.();
    } catch {
      setError("Не удалось удалить правило.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 15 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17 }}>Automation Builder</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>В UI доступны только условия и действия, которые сейчас исполняет Core.</div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Название правила" style={inputStyle} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(120px,1fr) auto", gap: 8 }}>
        <select value={event} onChange={(e) => setEvent(e.target.value)} style={inputStyle}>
          {EVENTS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input type="number" min={0} max={86400} value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))} style={inputStyle} />
        <button type="button" onClick={() => setEnabled((value) => !value)} style={buttonStyle("secondary")}>{enabled ? "ON" : "OFF"}</button>
      </div>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Conditions</div>
        {conditions.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>Без условий — правило реагирует на каждое событие выбранного типа.</div>}
        {conditions.map((condition, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(130px,180px) minmax(0,1fr) auto", gap: 8 }}>
            <select
              value={condition.type}
              onChange={(e) => setConditions((current) => current.map((item, i) => i === index ? { ...item, type: e.target.value as ConditionRow["type"] } : item))}
              style={inputStyle}
            >
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="channel-is">channel-is</option>
            </select>
            {condition.type === "channel-is" ? (
              <select value={condition.value} onChange={(e) => setConditions((current) => current.map((item, i) => i === index ? { ...item, value: e.target.value } : item))} style={inputStyle}>
                <option value="">Выбери канал</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            ) : (
              <input value={condition.value} maxLength={200} onChange={(e) => setConditions((current) => current.map((item, i) => i === index ? { ...item, value: e.target.value } : item))} placeholder="Значение" style={inputStyle} />
            )}
            <button type="button" onClick={() => setConditions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || conditions.length >= 10} onClick={() => setConditions((current) => [...current, { type: "contains", value: "" }])} style={buttonStyle("secondary")}>+ Условие</button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Actions</div>
        {actions.map((action, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(150px,180px) minmax(0,1fr) auto", gap: 8 }}>
            <select value={action.type} onChange={(e) => setActions((current) => current.map((item, i) => i === index ? { ...item, type: e.target.value as ActionRow["type"] } : item))} style={inputStyle}>
              <option value="send-message">send-message</option>
              <option value="log">log</option>
            </select>
            {action.type === "send-message" ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,220px) minmax(0,1fr)", gap: 8 }}>
                <select value={action.channelId} onChange={(e) => setActions((current) => current.map((item, i) => i === index ? { ...item, channelId: e.target.value } : item))} style={inputStyle}>
                  <option value="">Канал</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <input value={action.text} maxLength={2000} onChange={(e) => setActions((current) => current.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} placeholder="Сообщение" style={inputStyle} />
              </div>
            ) : (
              <input value={action.text} maxLength={1000} onChange={(e) => setActions((current) => current.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} placeholder="Сообщение в audit log" style={inputStyle} />
            )}
            <button type="button" disabled={saving || actions.length === 1} onClick={() => setActions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || actions.length >= 10} onClick={() => setActions((current) => [...current, { type: "log", channelId: "", text: "" }])} style={buttonStyle("secondary")}>+ Действие</button>
      </section>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving} onClick={() => void save()} style={buttonStyle("primary")}>{editingId ? "Сохранить изменения" : "Создать rule"}</button>
        {editingId && <button type="button" disabled={saving} onClick={reset} style={buttonStyle("secondary")}>Отмена</button>}
      </div>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Rules</div>
        {rules.length === 0 ? <div style={{ opacity: 0.42 }}>Правил пока нет.</div> : rules.map((rule) => (
          <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #1d212b" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{rule.name} · {rule.enabled ? "ON" : "OFF"}</div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>{rule.event} · {rule.all.length} conditions · {rule.actions.length} actions</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" disabled={saving} onClick={() => edit(rule)} style={buttonStyle("secondary")}>Изменить</button>
              <button type="button" disabled={saving} onClick={() => void remove(rule.id)} style={buttonStyle("danger")}>Удалить</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const inputStyle = {
  background: "#0d1016",
  color: "#f4f5f7",
  border: "1px solid #303643",
  borderRadius: 10,
  padding: "10px 11px",
  width: "100%",
  boxSizing: "border-box" as const
};

const sectionStyle = {
  display: "grid",
  gap: 9,
  padding: 13,
  border: "1px solid #202530",
  borderRadius: 12,
  background: "#0e1117"
} as const;

const sectionTitle = { fontSize: 12, opacity: 0.55, textTransform: "uppercase" as const, letterSpacing: 1 };

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21",
    color: "#fff",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
