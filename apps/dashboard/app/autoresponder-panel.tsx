"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };
type Rule = {
  id: number;
  trigger: string;
  matchType: "exact" | "contains" | "starts-with" | "regex";
  response: string;
  enabled: boolean;
  deleteTrigger: boolean;
  cooldownSeconds: number;
  priority: number;
  allowedRoleIds: string[];
  ignoredRoleIds: string[];
  allowedChannelIds: string[];
  ignoredChannelIds: string[];
};

const MATCH_TYPES = [
  ["contains", "Содержит"],
  ["exact", "Точное совпадение"],
  ["starts-with", "Начинается с"],
  ["regex", "Regex"]
] as const;

const EMPTY: Omit<Rule, "id"> = {
  trigger: "",
  matchType: "contains",
  response: "",
  enabled: true,
  deleteTrigger: false,
  cooldownSeconds: 0,
  priority: 0,
  allowedRoleIds: [],
  ignoredRoleIds: [],
  allowedChannelIds: [],
  ignoredChannelIds: []
};

export function AutoResponderPanel(props: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(props.guildId) + "/autoresponder", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "autoresponder_failed");
    setItems((body.rules ?? []) as Rule[]);
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить autoresponder."));
  }, [props.guildId]);

  function patch(patch: Partial<Rule>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setStatus("");
    try {
      const path = "/api/guilds/" + encodeURIComponent(props.guildId) + "/autoresponder" + (draft.id ? "/" + draft.id : "");
      const response = await fetch(path, {
        method: draft.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trigger: draft.trigger,
          matchType: draft.matchType,
          response: draft.response,
          enabled: draft.enabled,
          deleteTrigger: draft.deleteTrigger,
          cooldownSeconds: draft.cooldownSeconds,
          priority: draft.priority,
          allowedRoleIds: draft.allowedRoleIds,
          ignoredRoleIds: draft.ignoredRoleIds,
          allowedChannelIds: draft.allowedChannelIds,
          ignoredChannelIds: draft.ignoredChannelIds
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "autoresponder_save_failed");
      setItems((body.rules ?? []) as Rule[]);
      setDraft(null);
      setStatus("Автоответчик сохранён.");
      await props.onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить правило.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: Rule) {
    if (!window.confirm("Удалить автоответчик «" + rule.trigger + "»?")) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/autoresponder/" + rule.id,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "autoresponder_delete_failed");
      setItems((current) => current.filter((item) => item.id !== rule.id));
      if (draft?.id === rule.id) setDraft(null);
      setStatus("Автоответчик удалён.");
      await props.onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить правило.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {status && <div style={notice}>{status}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <span style={{ color: "#697486", fontSize: 10 }}>Ключевые слова → автоматический ответ, с фильтрами, cooldown и приоритетом.</span>
        <button type="button" onClick={() => setDraft({ id: 0, ...EMPTY })} disabled={busy} style={primary}>＋ Новый триггер</button>
      </div>

      {items.map((item) => (
        <div key={item.id} style={card}>
          <div>
            <strong style={{ fontSize: 12 }}>{item.trigger}</strong>
            <div style={{ color: "#596474", fontSize: 8, marginTop: 4 }}>
              {item.matchType} · priority {item.priority} · {item.cooldownSeconds ? "cooldown " + item.cooldownSeconds + "s" : "без cooldown"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={pill(item.enabled)}>{item.enabled ? "ON" : "OFF"}</span>
            <button type="button" onClick={() => setDraft({ ...item, allowedRoleIds: [...item.allowedRoleIds], ignoredRoleIds: [...item.ignoredRoleIds], allowedChannelIds: [...item.allowedChannelIds], ignoredChannelIds: [...item.ignoredChannelIds] })} disabled={busy} style={secondary}>Изменить</button>
            <button type="button" onClick={() => void remove(item)} disabled={busy} style={danger}>Удалить</button>
          </div>
        </div>
      ))}

      {!items.length && <div style={empty}>Автоответчиков пока нет.</div>}

      {draft && (
        <section style={editor}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 9 }}>
            <label style={field}><span>Триггер</span><input value={draft.trigger} maxLength={300} onChange={(e) => patch({ trigger: e.target.value })} style={input} placeholder="спасибо" /></label>
            <label style={field}><span>Тип совпадения</span><select value={draft.matchType} onChange={(e) => patch({ matchType: e.target.value as Rule["matchType"] })} style={input}>{MATCH_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label style={field}><span>Приоритет</span><input type="number" min={-1000} max={1000} value={draft.priority} onChange={(e) => patch({ priority: Number(e.target.value) })} style={input} /></label>
            <label style={field}><span>Cooldown, сек.</span><input type="number" min={0} max={86400} value={draft.cooldownSeconds} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} style={input} /></label>
          </div>

          <label style={field}>
            <span>Ответ</span>
            <textarea value={draft.response} maxLength={2000} onChange={(e) => patch({ response: e.target.value })} style={{ ...input, minHeight: 100, resize: "vertical" }} placeholder="Пожалуйста! {mention}" />
            <small style={{ color: "#5f6978", fontSize: 8 }}>Переменные: {"{user}"} {"{mention}"} {"{server}"} {"{channel}"}.</small>
          </label>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label style={check}><input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Включён</label>
            <label style={check}><input type="checkbox" checked={draft.deleteTrigger} onChange={(e) => patch({ deleteTrigger: e.target.checked })} /> Удалять исходное сообщение</label>
          </div>

          <IdPicker label="Только эти роли" values={draft.allowedRoleIds} options={props.roles} onChange={(values) => patch({ allowedRoleIds: values })} />
          <IdPicker label="Исключить роли" values={draft.ignoredRoleIds} options={props.roles} onChange={(values) => patch({ ignoredRoleIds: values })} />
          <IdPicker label="Только эти каналы" values={draft.allowedChannelIds} options={props.channels} onChange={(values) => patch({ allowedChannelIds: values })} />
          <IdPicker label="Исключить каналы" values={draft.ignoredChannelIds} options={props.channels} onChange={(values) => patch({ ignoredChannelIds: values })} />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} style={secondary}>Отмена</button>
            <button type="button" onClick={() => void save()} disabled={busy} style={primary}>{busy ? "Сохранение…" : "Сохранить"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function IdPicker(props: { label: string; values: string[]; options: Resource[]; onChange: (values: string[]) => void }) {
  return (
    <label style={field}>
      <span>{props.label}</span>
      <select multiple value={props.values} onChange={(e) => props.onChange([...e.currentTarget.selectedOptions].map((option) => option.value))} style={{ ...input, minHeight: 90 }}>
        {props.options.filter((item) => item.manageable !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
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
