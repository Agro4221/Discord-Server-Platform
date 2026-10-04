"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Condition =
  | { type: "contains" | "equals" | "starts-with" | "ends-with"; left: string; right: string }
  | { type: "matches"; left: string; pattern: string }
  | { type: "number-gte" | "number-lte" | "number-eq" | "number-gt" | "number-lt"; left: string; right: number }
  | { type: "has-role"; userId: string; roleId: string }
  | { type: "channel-is"; channelId: string }
  | { type: "cooldown-clear"; key: string };

type Action =
  | { type: "send-message"; channelId: string; content: string }
  | { type: "dm-user"; userId: string; content: string }
  | { type: "add-role" | "remove-role"; userId: string; roleId: string }
  | { type: "timeout"; userId: string; durationSeconds: number; reason: string }
  | { type: "delete-message"; channelId: string; messageId: string }
  | { type: "add-reaction" | "remove-reaction"; channelId: string; messageId: string; emoji: string }
  | { type: "pin-message" | "unpin-message"; channelId: string; messageId: string }
  | { type: "set-slowmode"; channelId: string; seconds: number }
  | { type: "set-channel-topic"; channelId: string; topic: string }
  | { type: "set-channel-name"; channelId: string; name: string }
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
  "message.create","message.delete","message.edit","reaction.add","reaction.remove",
  "channel.update","role.update",
  "voice.join","voice.leave","voice.move","moderation.case",
  "ticket.create","ticket.close","giveaway.end","schedule",
  "channel.create","channel.delete","role.create","role.delete","member.ban","member.unban","security.incident"
] as const;

const TEXT_FIELDS = ["content","userId","channelId","previousChannelId","messageId","guildId"] as const;
const NUMBER_FIELDS = ["memberCount","messageLength","mentionCount","previousLength","attachmentCount","embedCount","stickerCount","giveawayId","winnerCount","rolePosition","incidentId","actionCount","joinCount","timestamp","minute","hour","dayOfWeek","dayOfMonth"] as const;

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
      type === "number-gte" || type === "number-lte" || type === "number-eq" || type === "number-gt" || type === "number-lt" ? { type, left: "memberCount", right: 0 } :
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
      type === "add-reaction" || type === "remove-reaction" ? { type, channelId: "@event", messageId: "@event", emoji: "👍" } :
      type === "pin-message" || type === "unpin-message" ? { type, channelId: "@event", messageId: "@event" } :
      type === "set-slowmode" ? { type, channelId: "@event", seconds: 0 } :
      type === "set-channel-topic" ? { type, channelId: "@event", topic: "" } :
      type === "set-channel-name" ? { type, channelId: "@event", name: "" } :
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
              <option value="number-gt">number-gt</option>
              <option value="number-lt">number-lt</option>
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