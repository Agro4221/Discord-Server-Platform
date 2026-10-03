"use client";

import { useEffect, useMemo, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };
type Rule = {
  id: number;
  detector: string;
  enabled: boolean;
  threshold: number | null;
  windowSeconds: number | null;
  action: "delete" | "timeout" | "warn" | "log";
  timeoutMinutes: number;
  affectedRoleIds: string[];
  ignoredRoleIds: string[];
  affectedChannelIds: string[];
  ignoredChannelIds: string[];
  ignoreModerators: boolean;
  messageTemplate: string;
};

const DETECTORS = [
  ["bad-words", "Запрещённые слова"],
  ["links", "Ссылки"],
  ["invites", "Discord invites"],
  ["scam", "Scam / phishing"],
  ["repeated-text", "Повторяющиеся сообщения"],
  ["caps", "CAPS"],
  ["mentions", "Упоминания"],
  ["emoji-count", "Emoji"],
  ["zalgo", "Zalgo"],
  ["honeypot", "Honeypot"],
  ["line-length", "Длина строки"],
  ["link-count", "Количество ссылок"],
  ["mention-count", "Количество упоминаний"]
] as const;

const ACTIONS = [
  ["delete", "Удалить сообщение"],
  ["timeout", "Удалить + timeout"],
  ["warn", "Удалить + warn"],
  ["log", "Только лог"]
] as const;

const EMPTY_RULE: Omit<Rule, "id"> = {
  detector: "bad-words",
  enabled: true,
  threshold: null,
  windowSeconds: null,
  action: "delete",
  timeoutMinutes: 0,
  affectedRoleIds: [],
  ignoredRoleIds: [],
  affectedChannelIds: [],
  ignoredChannelIds: [],
  ignoreModerators: true,
  messageTemplate: ""
};

export function AutoModRulesPanel(props: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "automod_rules_failed");
    const next = (body.rules ?? []) as Rule[];
    setRules(next);
    if (draft) {
      const refreshed = next.find((item) => item.id === draft.id);
      if (refreshed) setDraft(refreshed);
    }
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить правила."));
  }, [props.guildId]);

  const detectorLabel = useMemo(
    () => new Map<string, string>(DETECTORS.map(([value, label]) => [value, label])),
    []
  );

  function startNew() {
    setDraft({ id: 0, ...EMPTY_RULE });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          detector: draft.detector,
          enabled: draft.enabled,
          threshold: draft.threshold,
          windowSeconds: draft.windowSeconds,
          action: draft.action,
          timeoutMinutes: draft.timeoutMinutes,
          affectedRoleIds: draft.affectedRoleIds,
          ignoredRoleIds: draft.ignoredRoleIds,
          affectedChannelIds: draft.affectedChannelIds,
          ignoredChannelIds: draft.ignoredChannelIds,
          ignoreModerators: draft.ignoreModerators,
          messageTemplate: draft.messageTemplate
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "automod_rule_save_failed");
      setRules((body.rules ?? []) as Rule[]);
      setDraft(null);
      setStatus("Правило сохранено.");
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить правило.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: Rule) {
    if (!window.confirm("Удалить правило «" + (detectorLabel.get(rule.detector) ?? rule.detector) + "»?")) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/automod/rules/" + rule.id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "automod_rule_delete_failed");
      setRules((current) => current.filter((item) => item.id !== rule.id));
      if (draft?.id === rule.id) setDraft(null);
      setStatus("Правило удалено.");
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить правило.");
    } finally {
      setBusy(false);
    }
  }

  function patchDraft(patch: Partial<Rule>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {status && <div style={noticeStyle}>{status}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ color: "#697486", fontSize: 10 }}>
          Точные правила имеют приоритет над базовыми AutoMod settings.
        </div>
        <button type="button" onClick={startNew} disabled={busy} style={buttonStyle}>＋ Новое правило</button>
      </div>

      {rules.length === 0 && <div style={emptyStyle}>Отдельные правила пока не настроены.</div>}

      {rules.map((rule) => (
        <div key={rule.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <strong style={{ fontSize: 12 }}>{detectorLabel.get(rule.detector) ?? rule.detector}</strong>
              <div style={{ color: "#697486", fontSize: 9, marginTop: 3 }}>
                {rule.action} · threshold {rule.threshold ?? "—"} · {rule.windowSeconds ?? "—"}s
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={pillStyle(rule.enabled)}>{rule.enabled ? "ON" : "OFF"}</span>
              <button type="button" onClick={() => setDraft(rule)} disabled={busy} style={smallButton}>Изменить</button>
              <button type="button" onClick={() => void remove(rule)} disabled={busy} style={dangerButton}>Удалить</button>
            </div>
          </div>
        </div>
      ))}

      {draft && (
        <section style={editorStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 }}>
            <label style={fieldStyle}>
              <span>Детектор</span>
              <select value={draft.detector} onChange={(e) => patchDraft({ detector: e.target.value })} style={inputStyle}>
                {DETECTORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>Действие</span>
              <select value={draft.action} onChange={(e) => patchDraft({ action: e.target.value as Rule["action"] })} style={inputStyle}>
                {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label style={checkField}>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => patchDraft({ enabled: e.target.checked })} />
              Правило включено
            </label>
            <label style={checkField}>
              <input type="checkbox" checked={draft.ignoreModerators} onChange={(e) => patchDraft({ ignoreModerators: e.target.checked })} />
              Игнорировать Manage Server
            </label>
            <label style={fieldStyle}>
              <span>Порог</span>
              <input
                type="number"
                value={draft.threshold ?? ""}
                min={0}
                onChange={(e) => patchDraft({ threshold: e.target.value === "" ? null : Number(e.target.value) })}
                style={inputStyle}
                placeholder="не задан"
              />
            </label>
            <label style={fieldStyle}>
              <span>Окно, сек.</span>
              <input
                type="number"
                value={draft.windowSeconds ?? ""}
                min={1}
                max={3600}
                onChange={(e) => patchDraft({ windowSeconds: e.target.value === "" ? null : Number(e.target.value) })}
                style={inputStyle}
                placeholder="для repeat/rate"
              />
            </label>
            {(draft.action === "timeout" || draft.action === "warn") && (
              <label style={fieldStyle}>
                <span>Timeout, минут</span>
                <input
                  type="number"
                  value={draft.timeoutMinutes}
                  min={0}
                  max={40320}
                  onChange={(e) => patchDraft({ timeoutMinutes: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            )}
            <label style={fieldStyle}>
              <span>Ответ после срабатывания</span>
              <input
                value={draft.messageTemplate}
                maxLength={1000}
                onChange={(e) => patchDraft({ messageTemplate: e.target.value })}
                style={inputStyle}
                placeholder="{mention} — сообщение удалено."
              />
            </label>
          </div>

          <IdPicker
            label="Только эти роли"
            values={draft.affectedRoleIds}
            options={props.roles}
            onChange={(values) => patchDraft({ affectedRoleIds: values })}
          />
          <IdPicker
            label="Исключить роли"
            values={draft.ignoredRoleIds}
            options={props.roles}
            onChange={(values) => patchDraft({ ignoredRoleIds: values })}
          />
          <IdPicker
            label="Только эти каналы"
            values={draft.affectedChannelIds}
            options={props.channels}
            onChange={(values) => patchDraft({ affectedChannelIds: values })}
          />
          <IdPicker
            label="Исключить каналы"
            values={draft.ignoredChannelIds}
            options={props.channels}
            onChange={(values) => patchDraft({ ignoredChannelIds: values })}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} style={smallButton}>Отмена</button>
            <button type="button" onClick={() => void save()} disabled={busy} style={buttonStyle}>{busy ? "Сохранение…" : "Сохранить правило"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function IdPicker(props: {
  label: string;
  values: string[];
  options: Resource[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <select
        multiple
        value={props.values}
        onChange={(e) => props.onChange([...e.currentTarget.selectedOptions].map((option) => option.value))}
        style={{ ...inputStyle, minHeight: 90 }}
      >
        {props.options.filter((item) => item.manageable !== false).map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      <small style={{ color: "#5f6978", fontSize: 8 }}>Ctrl/⌘ + click для нескольких.</small>
    </label>
  );
}

const cardStyle = { padding: 12, borderRadius: 12, border: "1px solid #232a35", background: "#0d1219" } as const;
const editorStyle = { display: "grid", gap: 10, padding: 14, borderRadius: 12, border: "1px solid #2c3949", background: "#0b1017" } as const;
const fieldStyle = { display: "grid", gap: 5, color: "#8d98a8", fontSize: 9 } as const;
const checkField = { display: "flex", gap: 7, alignItems: "center", color: "#8d98a8", fontSize: 9, padding: "9px 0" } as const;
const inputStyle = { background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px" } as const;
const buttonStyle = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 11px", cursor: "pointer" } as const;
const smallButton = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const dangerButton = { ...smallButton, border: "1px solid #5d3035", color: "#efacac" } as const;
const pillStyle = (active: boolean) => ({ padding: "5px 7px", borderRadius: 99, background: active ? "#173522" : "#1b2028", color: active ? "#82d99f" : "#838d9c", fontSize: 8 }) as const;
const noticeStyle = { padding: "9px 11px", borderRadius: 9, background: "#171d27", border: "1px solid #2b3543", color: "#9ba6b6", fontSize: 10 } as const;
const emptyStyle = { padding: "18px 10px", textAlign: "center" as const, color: "#5f6978", fontSize: 10, border: "1px dashed #29313d", borderRadius: 10 } as const;
