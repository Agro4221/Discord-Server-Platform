"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };

type Rule = {
  id: number; detector: string; enabled: boolean; threshold: number | null;
  windowSeconds: number | null; action: "delete" | "timeout" | "warn" | "log" | "ban";
  timeoutMinutes: number; affectedRoleIds: string[]; ignoredRoleIds: string[];
  affectedChannelIds: string[]; ignoredChannelIds: string[];
  ignoreModerators: boolean; logChannelId: string | null; messageTemplate: string;
};

const DETECTORS = [
  ["bad-words", "Запрещённые слова"], ["links", "Ссылки"], ["invites", "Discord invites"],
  ["scam", "Scam patterns"], ["repeated-text", "Повторы"], ["spam-burst", "Burst spam"], ["caps", "CAPS"],
  ["emotes", "Эмоты"], ["mentions", "Упоминания"], ["zalgo", "Zalgo"], ["honeypot", "Honeypot"],
  ["image-only", "Только изображения"], ["youtube-only", "Только YouTube"],
  ["line-length", "Длина строки"], ["link-count", "Количество ссылок"],
  ["mention-count", "Количество упоминаний"], ["emoji-count", "Количество эмодзи"]
];

const ACTIONS: Array<[Rule["action"], string]> = [
  ["delete", "Удалить"], ["timeout", "Удалить + timeout"], ["ban", "Удалить + ban"], ["warn", "Warn"], ["log", "Только лог"]
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
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [threshold, setThreshold] = useState("");
  const [windowSeconds, setWindowSeconds] = useState("");
  const [timeoutMinutes, setTimeoutMinutes] = useState("0");
  const [affectedChannelIds, setAffectedChannelIds] = useState<string[]>([]);
  const [ignoredChannelIds, setIgnoredChannelIds] = useState<string[]>([]);
  const [affectedRoleIds, setAffectedRoleIds] = useState<string[]>([]);
  const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
  const [ignoreModerators, setIgnoreModerators] = useState(true);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [logChannelId, setLogChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!props.guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "rules_failed"));
    setRules((body.rules ?? []) as Rule[]);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить AutoMod rules."));
  }, [props.guildId]);

  function resetForm() {
    setDetector("bad-words");
    setAction("delete");
    setEnabled(true);
    setEditingId(null);
    setThreshold("");
    setWindowSeconds("");
    setTimeoutMinutes("0");
    setAffectedChannelIds([]);
    setIgnoredChannelIds([]);
    setAffectedRoleIds([]);
    setIgnoredRoleIds([]);
    setIgnoreModerators(true);
    setLogChannelId("");
    setMessageTemplate("");
  }

  function editRule(rule: Rule) {
    setEditingId(rule.id);
    setDetector(rule.detector);
    setAction(rule.action);
    setEnabled(rule.enabled);
    setThreshold(rule.threshold === null ? "" : String(rule.threshold));
    setWindowSeconds(rule.windowSeconds === null ? "" : String(rule.windowSeconds));
    setTimeoutMinutes(String(rule.timeoutMinutes));
    setAffectedChannelIds(rule.affectedChannelIds);
    setIgnoredChannelIds(rule.ignoredChannelIds);
    setAffectedRoleIds(rule.affectedRoleIds);
    setIgnoredRoleIds(rule.ignoredRoleIds);
    setIgnoreModerators(rule.ignoreModerators);
    setLogChannelId(rule.logChannelId ?? "");
    setMessageTemplate(rule.messageTemplate);
    setError("");
  }

  async function persistRule(payload: Record<string, unknown>) {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "rule_save_failed"));
  }

  async function save() {
    const parsedThreshold = threshold === "" ? null : Number(threshold);
    const parsedWindowSeconds = windowSeconds === "" ? null : Number(windowSeconds);
    const parsedTimeoutMinutes = Number(timeoutMinutes || 0);

    if (parsedThreshold !== null && (!Number.isFinite(parsedThreshold) || parsedThreshold < 0)) {
      setError("Threshold должен быть конечным числом от 0.");
      return;
    }
    if (parsedWindowSeconds !== null && (!Number.isFinite(parsedWindowSeconds) || parsedWindowSeconds < 1)) {
      setError("Окно должно быть числом секунд от 1.");
      return;
    }
    if (!Number.isFinite(parsedTimeoutMinutes) || parsedTimeoutMinutes < 0 || parsedTimeoutMinutes > 40320) {
      setError("Timeout: 0–40320 минут.");
      return;
    }
    if (action === "log" && !logChannelId) {
      setError("Для action=log нужно выбрать log channel.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await persistRule({
        detector,
        enabled,
        action,
        threshold: parsedThreshold,
        windowSeconds: parsedWindowSeconds === null ? null : Math.floor(parsedWindowSeconds),
        timeoutMinutes: Math.floor(parsedTimeoutMinutes),
        affectedChannelIds,
        ignoredChannelIds,
        affectedRoleIds,
        ignoredRoleIds,
        ignoreModerators,
        logChannelId: logChannelId || null,
        messageTemplate
      });
      await load();
      resetForm();
      await props.onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить rule.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: Rule) {
    setBusy(true);
    setError("");
    try {
      await persistRule({
        detector: rule.detector,
        enabled: !rule.enabled,
        action: rule.action,
        threshold: rule.threshold,
        windowSeconds: rule.windowSeconds,
        timeoutMinutes: rule.timeoutMinutes,
        affectedChannelIds: rule.affectedChannelIds,
        ignoredChannelIds: rule.ignoredChannelIds,
        affectedRoleIds: rule.affectedRoleIds,
        ignoredRoleIds: rule.ignoredRoleIds,
        ignoreModerators: rule.ignoreModerators,
        logChannelId: rule.logChannelId,
        messageTemplate: rule.messageTemplate
      });
      await load();
      await props.onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить состояние rule.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: number) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules/" + id, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "rule_delete_failed"));
      if (editingId === id) resetForm();
      await load();
      await props.onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить rule.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelection(current: string[], id: string, setter: (value: string[]) => void) {
    setter(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error && <div style={{ padding: 9, borderRadius: 9, background: "#32191b", color: "#ffb1b1", fontSize: 10 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        {editingId !== null && (
          <div style={{ gridColumn: "1 / -1", padding: 9, borderRadius: 9, background: "#161d28", border: "1px solid #2b3544", color: "#9eabc0", fontSize: 10 }}>
            Редактирование правила #{editingId}
          </div>
        )}
        <label style={boxStyle}><span>Detector</span><select value={detector} onChange={(e) => setDetector(e.target.value)} style={inputStyle}>
          {DETECTORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label style={boxStyle}><span>Action</span><select value={action} onChange={(e) => setAction(e.target.value as Rule["action"])} style={inputStyle}>
          {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label style={boxStyle}><span>Threshold</span><input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min={0} style={inputStyle} placeholder="Авто по detector" /></label>
        <label style={boxStyle}><span>Окно, сек.</span><input value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)} type="number" min={1} style={inputStyle} placeholder="Необязательно" /></label>
        <label style={boxStyle}><span>Timeout, минут</span><input value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(e.target.value)} type="number" min={0} max={40320} style={inputStyle} /></label>
        <label style={{ ...boxStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>Rule enabled</span><input checked={enabled} onChange={(e) => setEnabled(e.target.checked)} type="checkbox" /></label>
        <label style={{ ...boxStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>Игнорировать модераторов</span><input checked={ignoreModerators} onChange={(e) => setIgnoreModerators(e.target.checked)} type="checkbox" /></label>
        <MultiSelect label="Затронутые каналы" values={affectedChannelIds} resources={props.channels} onToggle={(id) => toggleSelection(affectedChannelIds, id, setAffectedChannelIds)} />
        <MultiSelect label="Игнорировать каналы" values={ignoredChannelIds} resources={props.channels} onToggle={(id) => toggleSelection(ignoredChannelIds, id, setIgnoredChannelIds)} />
        <MultiSelect label="Затронутые роли" values={affectedRoleIds} resources={props.roles} onToggle={(id) => toggleSelection(affectedRoleIds, id, setAffectedRoleIds)} />
        <MultiSelect label="Игнорировать роли" values={ignoredRoleIds} resources={props.roles} onToggle={(id) => toggleSelection(ignoredRoleIds, id, setIgnoredRoleIds)} />
      </div>

      <label style={boxStyle}>
        <span>Log channel (для action=log)</span>
        <select value={logChannelId} onChange={(e) => setLogChannelId(e.target.value)} style={inputStyle} disabled={action !== "log"}>
          <option value="">Выберите канал</option>
          {props.channels.filter((channel) => channel.type !== 4).map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </label>

      <label style={boxStyle}>
        <span>Сообщение ответа (необязательно для log)</span>
        <textarea
          value={messageTemplate}
          onChange={(e) => setMessageTemplate(e.target.value)}
          style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
          maxLength={2000}
          placeholder="{mention}, {user}, {channel}"
        />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={buttonStyle}>{busy ? "Сохраняем…" : editingId !== null ? "Сохранить изменения" : "Создать rule"}</button>
        {editingId !== null && <button type="button" disabled={busy} onClick={resetForm} style={buttonStyleSecondary}>Отмена</button>}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {rules.map((rule) => (
          <div key={rule.id} style={ruleCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 11 }}>{rule.detector}</strong>
              <span style={pill}>{rule.action}</span>
              <span style={pill}>#{rule.id}</span>
              <span style={pill}>{rule.enabled ? "enabled" : "disabled"}</span>
              {rule.threshold !== null && <span style={pill}>threshold {rule.threshold}</span>}
              {rule.timeoutMinutes > 0 && <span style={pill}>timeout {rule.timeoutMinutes}m</span>}
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
                <button type="button" disabled={busy} onClick={() => editRule(rule)} style={buttonStyleSecondary}>Изменить</button>
                <button type="button" disabled={busy} onClick={() => void toggleRule(rule)} style={buttonStyleSecondary}>{rule.enabled ? "Выключить" : "Включить"}</button>
                <button type="button" disabled={busy} onClick={() => void removeRule(rule.id)} style={deleteButton}>Удалить</button>
              </div>
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
const buttonStyleSecondary = { border: "1px solid #303846", background: "#141922", color: "#dce2eb", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 8 };
const deleteButton = { border: "1px solid #6d3038", background: "#2c171b", color: "#ffb1b1", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 8 };
