"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Condition =
  | { type: "contains" | "equals" | "starts-with" | "ends-with"; left: string; right: string }
  | { type: "matches"; left: string; pattern: string }
  | { type: "number-gte" | "number-lte" | "number-eq"; left: string; right: number }
  | { type: "has-role"; userId: string; roleId: string }
  | { type: "channel-is"; channelId: string }
  | { type: "cooldown-clear"; key: string };

type Action =
  | { type: "send-message"; channelId: string; content: string }
  | { type: "dm-user"; userId: string; content: string }
  | { type: "add-role" | "remove-role"; userId: string; roleId: string }
  | { type: "timeout"; userId: string; durationSeconds: number; reason: string }
  | { type: "delete-message"; channelId: string; messageId: string }
  | { type: "add-reaction"; channelId: string; messageId: string; emoji: string }
  | { type: "log"; message: string };

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  all: Condition[];
  any: Condition[];
  actions: Action[];
  cooldownSeconds: number;
};

const EVENTS = [
  "member.join","member.leave","member.role.add","member.role.remove",
  "message.create","message.delete","message.edit","reaction.add",
  "voice.join","voice.leave","voice.move","moderation.case",
  "ticket.create","ticket.close","giveaway.end","schedule",
  "channel.create","channel.delete","role.create","role.delete","member.ban","member.unban","security.incident"
] as const;

const TEXT_FIELDS = ["content","userId","channelId","messageId","guildId"] as const;
const NUMBER_FIELDS = ["memberCount","messageLength","mentionCount","previousLength","giveawayId","winnerCount","rolePosition","incidentId","actionCount","joinCount","timestamp","minute","hour","dayOfWeek","dayOfMonth"] as const;

export function AutomationPanel({
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
  const [rules, setRules] = useState<Rule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Новое правило");
  const [event, setEvent] = useState<string>("message.create");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [anyConditions, setAnyConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([{ type: "send-message", channelId: "", content: "" }]);
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
    setAnyConditions([]);
    setActions([{ type: "send-message", channelId: "", content: "" }]);
    setError("");
  }

  function edit(rule: Rule) {
    setEditingId(rule.id);
    setName(rule.name);
    setEvent(rule.event);
    setCooldownSeconds(rule.cooldownSeconds);
    setEnabled(rule.enabled);
    setConditions(Array.isArray(rule.all) ? rule.all : []);
    setAnyConditions(Array.isArray(rule.any) ? rule.any : []);
    setActions(Array.isArray(rule.actions) ? rule.actions : []);
    setError("");
  }

  async function save() {
    if (!name.trim()) {
      setError("Укажи название правила.");
      return;
    }
    if (
      actions.length < 1 ||
      actions.length > 10 ||
      conditions.length > 10 ||
      anyConditions.length > 10 ||
      conditions.length + anyConditions.length > 10
    ) {
      setError("Нужно максимум 10 условий суммарно и 1–10 действий.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = "/api/guilds/" + encodeURIComponent(guildId) + "/automation" + (editingId ? "/" + encodeURIComponent(editingId) : "");
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          event,
          cooldownSeconds,
          enabled,
          conditions,
          anyConditions,
          actions
        })
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

  function updateCondition(index: number, patch: Partial<Condition>, any = false) {
    const setter = any ? setAnyConditions : setConditions;
    setter((current) => current.map((item, i) => i === index ? { ...item, ...patch } as Condition : item));
  }

  function replaceCondition(index: number, type: Condition["type"], any = false) {
    const next: Condition =
      type === "channel-is" ? { type, channelId: "" } :
      type === "matches" ? { type, left: "content", pattern: "" } :
      type === "number-gte" || type === "number-lte" || type === "number-eq" ? { type, left: "memberCount", right: 0 } :
      type === "has-role" ? { type, userId: "@event", roleId: "" } :
      type === "cooldown-clear" ? { type, key: "" } :
      { type, left: "content", right: "" };
    const setter = any ? setAnyConditions : setConditions;
    setter((current) => current.map((item, i) => i === index ? next : item));
  }

  function updateAction(index: number, patch: Partial<Action>) {
    setActions((current) => current.map((item, i) => i === index ? { ...item, ...patch } as Action : item));
  }

  function replaceAction(index: number, type: Action["type"]) {
    const next: Action =
      type === "send-message" ? { type, channelId: "", content: "" } :
      type === "dm-user" ? { type, userId: "@event", content: "" } :
      type === "add-role" || type === "remove-role" ? { type, userId: "@event", roleId: "" } :
      type === "timeout" ? { type, userId: "@event", durationSeconds: 60, reason: "" } :
      type === "delete-message" ? { type, channelId: "@event", messageId: "@event" } :
      type === "add-reaction" ? { type, channelId: "@event", messageId: "@event", emoji: "👍" } :
      { type: "log", message: "" };
    setActions((current) => current.map((item, i) => i === index ? next : item));
  }

  return (
    <div style={{ display: "grid", gap: 15 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 17 }}>Automation Builder</h3>
        <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>
          Полный каталог событий, условий и действий, которые исполняет Core.
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Название правила" style={inputStyle} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(120px,1fr) auto", gap: 8 }}>
        <select value={event} onChange={(e) => setEvent(e.target.value)} style={inputStyle}>
          {EVENTS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input type="number" min={0} max={86400} value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))} style={inputStyle} />
        <button type="button" onClick={() => setEnabled((value) => !value)} style={buttonStyle("secondary")}>{enabled ? "ON" : "OFF"}</button>
      </div>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Conditions · ALL</div>
        {conditions.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>Без условий — правило реагирует на каждый выбранный event.</div>}
        {conditions.map((condition, index) => (
          <div key={index} style={rowStyle}>
            <select value={condition.type} onChange={(e) => replaceCondition(index, e.target.value as Condition["type"])} style={inputStyle}>
              <option value="contains">contains</option>
              <option value="starts-with">starts-with</option>
              <option value="ends-with">ends-with</option>
              <option value="equals">equals</option>
              <option value="matches">matches</option>
              <option value="number-gte">number-gte</option>
              <option value="number-lte">number-lte</option>
              <option value="number-eq">number-eq</option>
              <option value="has-role">has-role</option>
              <option value="channel-is">channel-is</option>
              <option value="cooldown-clear">cooldown-clear</option>
            </select>

            {(condition.type === "contains" || condition.type === "equals" || condition.type === "starts-with" || condition.type === "ends-with" || condition.type === "matches") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value })} style={inputStyle}>
                  {TEXT_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input
                  value={condition.type === "matches" ? condition.pattern : condition.right}
                  maxLength={condition.type === "matches" ? 120 : 200}
                  onChange={(e) => updateCondition(index, condition.type === "matches" ? { pattern: e.target.value } : { right: e.target.value })}
                  placeholder={condition.type === "matches" ? "Regex" : "Значение"}
                  style={inputStyle}
                />
              </>
            )}

            {(condition.type === "number-gte" || condition.type === "number-lte") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value })} style={inputStyle}>
                  {NUMBER_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input type="number" value={condition.right} onChange={(e) => updateCondition(index, { right: Number(e.target.value) })} style={inputStyle} />
              </>
            )}

            {condition.type === "has-role" && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={condition.roleId} onChange={(e) => updateCondition(index, { roleId: e.target.value })} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </>
            )}

            {condition.type === "channel-is" && (
              <select value={condition.channelId} onChange={(e) => updateCondition(index, { channelId: e.target.value })} style={inputStyle}>
                <option value="">Канал</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            )}

            {condition.type === "cooldown-clear" && (
              <input value={condition.key} maxLength={100} onChange={(e) => updateCondition(index, { key: e.target.value })} placeholder="Имя cooldown key" style={inputStyle} />
            )}

            <button type="button" onClick={() => setConditions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || conditions.length >= 10} onClick={() => setConditions((current) => [...current, { type: "contains", left: "content", right: "" }])} style={buttonStyle("secondary")}>+ Условие</button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Conditions · ANY</div>
        {anyConditions.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>Нет OR-условий. Заполни их, если достаточно любого совпадения.</div>}
        {anyConditions.map((condition, index) => (
          <div key={"any-" + index} style={rowStyle}>
            <select value={condition.type} onChange={(e) => replaceCondition(index, e.target.value as Condition["type"], true)} style={inputStyle}>
              <option value="contains">contains</option>
              <option value="starts-with">starts-with</option>
              <option value="ends-with">ends-with</option>
              <option value="equals">equals</option>
              <option value="matches">matches</option>
              <option value="number-gte">number-gte</option>
              <option value="number-lte">number-lte</option>
              <option value="number-eq">number-eq</option>
              <option value="has-role">has-role</option>
              <option value="channel-is">channel-is</option>
              <option value="cooldown-clear">cooldown-clear</option>
            </select>

            {(condition.type === "contains" || condition.type === "equals" || condition.type === "starts-with" || condition.type === "ends-with" || condition.type === "matches") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value }, true)} style={inputStyle}>
                  {TEXT_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input
                  value={condition.type === "matches" ? condition.pattern : condition.right}
                  maxLength={condition.type === "matches" ? 120 : 200}
                  onChange={(e) => updateCondition(index, condition.type === "matches" ? { pattern: e.target.value } : { right: e.target.value }, true)}
                  placeholder={condition.type === "matches" ? "Regex" : "Значение"}
                  style={inputStyle}
                />
              </>
            )}

            {(condition.type === "number-gte" || condition.type === "number-lte") && (
              <>
                <select value={condition.left} onChange={(e) => updateCondition(index, { left: e.target.value }, true)} style={inputStyle}>
                  {NUMBER_FIELDS.map((field) => <option key={field}>{field}</option>)}
                </select>
                <input type="number" value={condition.right} onChange={(e) => updateCondition(index, { right: Number(e.target.value) }, true)} style={inputStyle} />
              </>
            )}

            {condition.type === "has-role" && (
              <>
                <input value={condition.userId} onChange={(e) => updateCondition(index, { userId: e.target.value }, true)} placeholder="@event или user ID" style={inputStyle} />
                <select value={condition.roleId} onChange={(e) => updateCondition(index, { roleId: e.target.value }, true)} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </>
            )}

            {condition.type === "channel-is" && (
              <select value={condition.channelId} onChange={(e) => updateCondition(index, { channelId: e.target.value }, true)} style={inputStyle}>
                <option value="">Канал</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            )}

            {condition.type === "cooldown-clear" && (
              <input value={condition.key} maxLength={100} onChange={(e) => updateCondition(index, { key: e.target.value }, true)} placeholder="Имя cooldown key" style={inputStyle} />
            )}

            <button type="button" onClick={() => setAnyConditions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button
          type="button"
          disabled={saving || conditions.length + anyConditions.length >= 10}
          onClick={() => setAnyConditions((current) => [...current, { type: "contains", left: "content", right: "" }])}
          style={buttonStyle("secondary")}
        >
          + OR-условие
        </button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Actions</div>
        {actions.map((action, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(150px,180px) minmax(0,1fr) auto", gap: 8 }}>
            <select value={action.type} onChange={(e) => replaceAction(index, e.target.value as Action["type"])} style={inputStyle}>
              <option value="send-message">send-message</option>
              <option value="dm-user">dm-user</option>
              <option value="add-role">add-role</option>
              <option value="remove-role">remove-role</option>
              <option value="timeout">timeout</option>
              <option value="delete-message">delete-message</option>
              <option value="add-reaction">add-reaction</option>
              <option value="log">log</option>
            </select>

            {action.type === "send-message" && (
              <div style={actionGrid}>
                <select value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} style={inputStyle}>
                  <option value="">Канал</option>
                  <option value="@event">Канал события</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <input value={action.content} maxLength={2000} onChange={(e) => updateAction(index, { content: e.target.value })} placeholder="Текст · {user} {channel} {content}" style={inputStyle} />
              </div>
            )}

            {action.type === "dm-user" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input value={action.content} maxLength={2000} onChange={(e) => updateAction(index, { content: e.target.value })} placeholder="Личное сообщение" style={inputStyle} />
              </div>
            )}

            {(action.type === "add-role" || action.type === "remove-role") && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <select value={action.roleId} onChange={(e) => updateAction(index, { roleId: e.target.value })} style={inputStyle}>
                  <option value="">Роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </div>
            )}

            {action.type === "timeout" && (
              <div style={actionGrid}>
                <input value={action.userId} onChange={(e) => updateAction(index, { userId: e.target.value })} placeholder="@event или user ID" style={inputStyle} />
                <input type="number" min={1} max={2419200} value={action.durationSeconds} onChange={(e) => updateAction(index, { durationSeconds: Number(e.target.value) })} style={inputStyle} />
                <input value={action.reason} maxLength={500} onChange={(e) => updateAction(index, { reason: e.target.value })} placeholder="Причина" style={inputStyle} />
              </div>
            )}

            {action.type === "delete-message" && (
              <div style={actionGrid}>
                <input value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} placeholder="@event или channel ID" style={inputStyle} />
                <input value={action.messageId} onChange={(e) => updateAction(index, { messageId: e.target.value })} placeholder="@event или message ID" style={inputStyle} />
              </div>
            )}

            {action.type === "add-reaction" && (
              <div style={actionGrid}>
                <select value={action.channelId} onChange={(e) => updateAction(index, { channelId: e.target.value })} style={inputStyle}>
                  <option value="@event">Канал события</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <input value={action.messageId} onChange={(e) => updateAction(index, { messageId: e.target.value })} placeholder="@event или message ID" style={inputStyle} />
                <input value={action.emoji} maxLength={100} onChange={(e) => updateAction(index, { emoji: e.target.value })} placeholder="Emoji, например 👍" style={inputStyle} />
              </div>
            )}

            {action.type === "log" && (
              <input value={action.message} maxLength={1000} onChange={(e) => updateAction(index, { message: e.target.value })} placeholder="Audit log message" style={inputStyle} />
            )}

            <button type="button" disabled={saving || actions.length === 1} onClick={() => setActions((current) => current.filter((_, i) => i !== index))} style={buttonStyle("secondary")}>×</button>
          </div>
        ))}
        <button type="button" disabled={saving || actions.length >= 10} onClick={() => setActions((current) => [...current, { type: "log", message: "" }])} style={buttonStyle("secondary")}>+ Действие</button>
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
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>{rule.event} · {rule.all.length} ALL + {rule.any.length} ANY · {rule.actions.length} actions</div>
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
  borderRadius: 9,
  padding: "9px 10px",
  width: "100%",
  boxSizing: "border-box" as const
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px,180px) minmax(0,1fr) minmax(0,1fr) auto",
  gap: 8,
  alignItems: "center"
} as const;

const actionGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
  gap: 8
} as const;

const sectionStyle = {
  display: "grid",
  gap: 9,
  padding: 13,
  border: "1px solid #202530",
  borderRadius: 12,
  background: "#0e1117"
} as const;

const sectionTitle = {
  fontSize: 12,
  opacity: 0.55,
  textTransform: "uppercase" as const,
  letterSpacing: 1
};

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  return {
    border: "1px solid " + (kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643"),
    background: kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21",
    color: "#fff",
    borderRadius: 9,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
