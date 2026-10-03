"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };

type Rule = {
  id: number; detector: string; enabled: boolean; threshold: number | null;
  windowSeconds: number | null; action: "delete" | "timeout" | "warn" | "log";
  timeoutMinutes: number; affectedRoleIds: string[]; ignoredRoleIds: string[];
  affectedChannelIds: string[]; ignoredChannelIds: string[];
  ignoreModerators: boolean; messageTemplate: string;
};

const DETECTORS = [
  ["bad-words", "Запрещённые слова"], ["links", "Ссылки"], ["invites", "Discord invites"],
  ["scam", "Scam patterns"], ["caps", "CAPS"], ["mentions", "Упоминания"],
  ["emoji-count", "Emoji count"], ["line-length", "Длина строки"], ["link-count", "Количество ссылок"],
  ["zalgo", "Zalgo"], ["honeypot", "Honeypot"], ["repeated-text", "Повторы"], ["content", "Контент"]
];

const ACTIONS: Array<[Rule["action"], string]> = [
  ["delete", "Удалить"], ["timeout", "Удалить + timeout"], ["warn", "Warn"], ["log", "Только лог"]
];

export function AutoModRulesPanel(props: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [detector, setDetector] = useState("bad-words");
  const [action, setAction] = useState<Rule["action"]>("delete");
  const [threshold, setThreshold] = useState("");
  const [windowSeconds, setWindowSeconds] = useState("");
  const [timeoutMinutes, setTimeoutMinutes] = useState("0");
  const [affectedChannelIds, setAffectedChannelIds] = useState<string[]>([]);
  const [ignoredChannelIds, setIgnoredChannelIds] = useState<string[]>([]);
  const [affectedRoleIds, setAffectedRoleIds] = useState<string[]>([]);
  const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
  const [ignoreModerators, setIgnoreModerators] = useState(true);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "rules_failed"));
    setRules((body.rules ?? []) as Rule[]);
  }

  useEffect(() => { void load().catch(() => setError("Не удалось загрузить AutoMod rules.")); }, [props.guildId]);

  async function save() {
    setSaving(true); setError("");
    try {
      const payload = {
        detector, action,
        threshold: threshold === "" ? null : Number(threshold),
        windowSeconds: windowSeconds === "" ? null : Number(windowSeconds),
        timeoutMinutes: Number(timeoutMinutes || 0),
        affectedChannelIds, ignoredChannelIds, affectedRoleIds, ignoredRoleIds,
        ignoreModerators, messageTemplate
      };
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "rule_save_failed"));
      await load();
      props.onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить rule.");
    } finally { setSaving(false); }
  }

  async function remove(id: number) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules/" + id, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "rule_delete_failed"));
      await load(); props.onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить rule.");
    } finally { setSaving(false); }
  }

  function toggleSelection(current: string[], id: string, setter: (value: string[]) => void) {
    setter(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error && <div style={{ padding: 9, borderRadius: 9, background: "#32191b", color: "#ffb1b1", fontSize: 10 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        <label style={boxStyle}><span>Detector</span><select value={detector} onChange={(e) => setDetector(e.target.value)} style={inputStyle}>
          {DETECTORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label style={boxStyle}><span>Action</span><select value={action} onChange={(e) => setAction(e.target.value as Rule["action"])} style={inputStyle}>
          {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label style={boxStyle}><span>Threshold</span><input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" style={inputStyle} placeholder="Авто по detector" /></label>
        <label style={boxStyle}><span>Окно, сек.</span><input value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)} type="number" style={inputStyle} placeholder="Необязательно" /></label>
        <label style={boxStyle}><span>Timeout, минут</span><input value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(e.target.value)} type="number" min={0} max={40320} style={inputStyle} /></label>
        <label style={{ ...boxStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>Игнорировать модераторов</span><input checked={ignoreModerators} onChange={(e) => setIgnoreModerators(e.target.checked)} type="checkbox" /></label>
        <MultiSelect label="Затронутые каналы" values={affectedChannelIds} resources={props.channels} onToggle={(id) => toggleSelection(affectedChannelIds, id, setAffectedChannelIds)} />
        <MultiSelect label="Игнорировать каналы" values={ignoredChannelIds} resources={props.channels} onToggle={(id) => toggleSelection(ignoredChannelIds, id, setIgnoredChannelIds)} />
        <MultiSelect label="Затронутые роли" values={affectedRoleIds} resources={props.roles} onToggle={(id) => toggleSelection(affectedRoleIds, id, setAffectedRoleIds)} />
        <MultiSelect label="Игнорировать роли" values={ignoredRoleIds} resources={props.roles} onToggle={(id) => toggleSelection(ignoredRoleIds, id, setIgnoredRoleIds)} />
      </div>
      <label style={boxStyle}><span>Response / template</span><textarea value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="{mention} ..." /></label>
      <button type="button" disabled={saving} onClick={() => void save()} style={buttonStyle}>{saving ? "Сохраняем…" : "Добавить / обновить rule"}</button>

      <div style={{ display: "grid", gap: 8 }}>
        {rules.map((rule) => (
          <div key={rule.id} style={ruleCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 11 }}>{rule.detector}</strong><span style={pill}>{rule.action}</span><span style={pill}>#{rule.id}</span>
              {rule.threshold !== null && <span style={pill}>threshold {rule.threshold}</span>}
              {rule.timeoutMinutes > 0 && <span style={pill}>timeout {rule.timeoutMinutes}m</span>}
              <button type="button" disabled={saving} onClick={() => void remove(rule.id)} style={deleteButton}>Удалить</button>
            </div>
            <div style={{ marginTop: 6, color: "#6d7888", fontSize: 9 }}>
              Каналы: {rule.affectedChannelIds.length ? rule.affectedChannelIds.length : "все"} · роли: {rule.affectedRoleIds.length ? rule.affectedRoleIds.length : "все"} · {rule.ignoreModerators ? "mods ignored" : "mods included"}
            </div>
          </div>
        ))}
        {!rules.length && <div style={{ color: "#697485", fontSize: 10 }}>Правил пока нет.</div>}
      </div>
    </div>
  );
}

function MultiSelect(props: { label: string; values: string[]; resources: Resource[]; onToggle: (id: string) => void }) {
  return <label style={boxStyle}><span>{props.label}</span><div style={{ display: "grid", gap: 4, maxHeight: 150, overflowY: "auto", padding: 6, border: "1px solid #252d38", borderRadius: 9 }}>
    {props.resources.map((resource) => <label key={resource.id} style={{ display: "flex", gap: 7, alignItems: "center", color: "#9aa4b3", fontSize: 9 }}>
      <input type="checkbox" checked={props.values.includes(resource.id)} onChange={() => props.onToggle(resource.id)} />{resource.name}
    </label>)}
    {!props.resources.length && <span style={{ color: "#596475", fontSize: 9 }}>Нет ресурсов.</span>}
  </div></label>;
}

const inputStyle = { background: "#0c1016", color: "#f4f6fa", border: "1px solid #303846", borderRadius: 9, padding: "9px 10px", width: "100%", boxSizing: "border-box" as const };
const boxStyle = { display: "grid", gap: 5, color: "#798496", fontSize: 9 };
const buttonStyle = { border: "1px solid #5865f2", background: "#5865f2", color: "#fff", borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 10, fontWeight: 650 };
const pill = { padding: "3px 6px", borderRadius: 6, background: "#161c24", border: "1px solid #29313c", color: "#738095", fontSize: 8 };
const ruleCard = { padding: 11, borderRadius: 10, border: "1px solid #222a35", background: "#0d1219" };
const deleteButton = { marginLeft: "auto", border: "1px solid #6d3038", background: "#2c171b", color: "#ffb1b1", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 8 };
