"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type Field = {
  id: string;
  label: string;
  type: "short" | "paragraph";
  required: boolean;
  placeholder: string;
  minLength: number;
  maxLength: number;
};
type Form = {
  name: string;
  title: string;
  description: string;
  panelChannelId: string | null;
  responseChannelId: string | null;
  buttonLabel: string;
  enabled: boolean;
  fields: Field[];
  fieldCount: number;
};

const EMPTY_FIELD: Field = {
  id: "field_1",
  label: "Поле",
  type: "short",
  required: true,
  placeholder: "",
  minLength: 0,
  maxLength: 100
};

const EMPTY_FORM: Form = {
  name: "contact",
  title: "Связаться с нами",
  description: "Заполни форму.",
  panelChannelId: null,
  responseChannelId: null,
  buttonLabel: "Заполнить форму",
  enabled: true,
  fields: [
    { id: "subject", label: "Тема", type: "short", required: true, placeholder: "Тема", minLength: 3, maxLength: 100 },
    { id: "details", label: "Описание", type: "paragraph", required: true, placeholder: "Подробности", minLength: 10, maxLength: 2000 }
  ],
  fieldCount: 2
};

export function FormsPanel({ guildId, channels, onChanged }: { guildId: string; channels: Resource[]; onChanged?: () => void | Promise<void> }) {
  const [forms, setForms] = useState<Form[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [isNew, setIsNew] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/forms", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "forms_load_failed");
    const next = (body.forms ?? []) as Form[];
    setForms(next);
    if (next.length && isNew) {
      setForm(next[0]);
      setIsNew(false);
    }
  }

  useEffect(() => {
    setStatus("");
    setForms([]);
    setForm({ ...EMPTY_FORM, fields: EMPTY_FORM.fields.map((field) => ({ ...field })), panelChannelId: null, responseChannelId: null });
    setIsNew(true);
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить формы."));
  }, [guildId]);

  function select(name: string) {
    const selected = forms.find((item) => item.name === name);
    if (selected) {
      setForm({ ...selected, fields: selected.fields.map((field) => ({ ...field })) });
      setIsNew(false);
      setStatus("");
    }
  }

  function patchField(index: number, patch: Partial<Field>) {
    setForm((current) => ({ ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...patch } : field) }));
  }

  async function save() {
    if (!/^[a-z0-9_-]{1,40}$/.test(form.name.trim())) {
      setStatus("Имя формы: только латиница, цифры, _ и -.");
      return;
    }
    if (!form.fields.length || form.fields.length > 5) {
      setStatus("Форма должна содержать 1–5 полей.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const url = isNew
        ? "/api/guilds/" + encodeURIComponent(guildId) + "/forms"
        : "/api/guilds/" + encodeURIComponent(guildId) + "/forms/" + encodeURIComponent(form.name);
      const response = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, name: form.name.trim().toLowerCase() })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "form_save_failed");
      setForm(body.form);
      setIsNew(false);
      setStatus("Форма сохранена.");
      await load();
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить форму.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (isNew) {
      setStatus("Сначала сохрани форму.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/forms/" + encodeURIComponent(form.name) + "/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: form.panelChannelId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "form_publish_failed");
      setStatus("Панель формы опубликована.");
      await load();
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось опубликовать форму.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (isNew || !window.confirm("Удалить форму «" + form.name + "»?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/forms/" + encodeURIComponent(form.name), { method: "DELETE" });
      if (!response.ok) throw new Error("form_delete_failed");
      setForm({ ...EMPTY_FORM, fields: EMPTY_FORM.fields.map((field) => ({ ...field })) });
      setIsNew(true);
      setStatus("Форма удалена.");
      await load();
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить форму.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {status && <div style={notice}>{status}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <select value={isNew ? "__new__" : form.name} onChange={(e) => e.target.value === "__new__" ? (setForm({ ...EMPTY_FORM, fields: EMPTY_FORM.fields.map((field) => ({ ...field })) }), setIsNew(true)) : select(e.target.value)} style={input}>
          <option value="__new__">＋ Новая форма</option>
          {forms.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.title}</option>)}
        </select>
      </div>

      <div style={card}>
        <div style={grid2}>
          <label style={label}><span>Имя</span><input value={form.name} disabled={!isNew} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} /></label>
          <label style={label}><span>Кнопка</span><input value={form.buttonLabel} maxLength={80} onChange={(e) => setForm({ ...form, buttonLabel: e.target.value })} style={input} /></label>
          <label style={label}><span>Заголовок</span><input value={form.title} maxLength={256} onChange={(e) => setForm({ ...form, title: e.target.value })} style={input} /></label>
          <label style={label}><span>Панель публиковать в</span><select value={form.panelChannelId ?? ""} onChange={(e) => setForm({ ...form, panelChannelId: e.target.value || null })} style={input}><option value="">Выбрать канал</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
          <label style={label}><span>Канал ответов</span><select value={form.responseChannelId ?? ""} onChange={(e) => setForm({ ...form, responseChannelId: e.target.value || null })} style={input}><option value="">Не отправлять в канал</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
          <label style={check}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Включена</label>
        </div>
        <label style={label}><span>Описание</span><textarea value={form.description} maxLength={4096} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input, minHeight: 80 }} /></label>
      </div>

      {form.fields.map((field, index) => (
        <div key={field.id + ":" + index} style={card}>
          <div style={grid3}>
            <label style={label}><span>ID</span><input value={field.id} maxLength={30} onChange={(e) => patchField(index, { id: e.target.value })} style={input} /></label>
            <label style={label}><span>Название</span><input value={field.label} maxLength={45} onChange={(e) => patchField(index, { label: e.target.value })} style={input} /></label>
            <label style={label}><span>Тип</span><select value={field.type} onChange={(e) => patchField(index, { type: e.target.value as Field["type"], maxLength: e.target.value === "paragraph" ? 2000 : 100 })} style={input}><option value="short">Short</option><option value="paragraph">Paragraph</option></select></label>
            <label style={label}><span>Минимум</span><input type="number" min={0} max={field.maxLength} value={field.minLength} onChange={(e) => patchField(index, { minLength: Number(e.target.value) })} style={input} /></label>
            <label style={label}><span>Максимум</span><input type="number" min={1} max={field.type === "paragraph" ? 4000 : 400} value={field.maxLength} onChange={(e) => patchField(index, { maxLength: Number(e.target.value) })} style={input} /></label>
            <label style={check}><input type="checkbox" checked={field.required} onChange={(e) => patchField(index, { required: e.target.checked })} /> Обязательно</label>
          </div>
          <label style={label}><span>Placeholder</span><input value={field.placeholder} maxLength={100} onChange={(e) => patchField(index, { placeholder: e.target.value })} style={input} /></label>
          <button type="button" disabled={busy || form.fields.length <= 1} onClick={() => setForm((current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }))} style={danger}>Удалить поле</button>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button type="button" disabled={busy || form.fields.length >= 5} onClick={() => setForm((current) => ({ ...current, fields: [...current.fields, { ...EMPTY_FIELD, id: "field_" + (current.fields.length + 1) }] }))} style={secondary}>＋ Поле</button>
        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && <button type="button" disabled={busy} onClick={() => void publish()} style={secondary}>Опубликовать</button>}
          {!isNew && <button type="button" disabled={busy} onClick={() => void remove()} style={danger}>Удалить форму</button>}
          <button type="button" disabled={busy} onClick={() => void save()} style={primary}>{busy ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}

const input={width:"100%",boxSizing:"border-box" as const,background:"#0d1118",color:"#f4f6fa",border:"1px solid #303846",borderRadius:10,padding:"9px 10px"};
const label={display:"grid",gap:4,fontSize:10,color:"#98a3b5"};
const check={display:"flex",alignItems:"center",gap:7,fontSize:10,color:"#98a3b5"};
const grid2={display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8};
const grid3={display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8};
const card={display:"grid",gap:9,padding:12,border:"1px solid #202632",borderRadius:12,background:"#0b0f15"};
const primary={border:"1px solid #3f6fd1",background:"#1b3b75",color:"#fff",borderRadius:10,padding:"9px 12px",cursor:"pointer"};
const secondary={border:"1px solid #303846",background:"#171c25",color:"#fff",borderRadius:10,padding:"9px 12px",cursor:"pointer"};
const danger={border:"1px solid #63292d",background:"#32191b",color:"#fff",borderRadius:10,padding:"8px 11px",cursor:"pointer"};
const notice={padding:10,borderRadius:10,background:"#13251a",border:"1px solid #2d5a37",fontSize:11};
