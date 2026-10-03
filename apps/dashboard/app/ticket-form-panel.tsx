"use client";

import { useEffect, useState } from "react";

type Field = {
  id: string;
  label: string;
  type: "short" | "paragraph";
  required: boolean;
  placeholder: string;
  maxLength: number;
};

const EMPTY: Field = {
  id: "field_1",
  label: "Поле",
  type: "short",
  required: true,
  placeholder: "",
  maxLength: 100
};

export function TicketFormPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/form", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "ticket_form_failed");
    setFields((body.fields ?? []) as Field[]);
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить форму."));
  }, [guildId]);

  function patch(index: number, patchValue: Partial<Field>) {
    setFields((current) => current.map((field, i) => i === index ? { ...field, ...patchValue } : field));
  }

  function addField() {
    if (fields.length >= 5) {
      setStatus("Discord modal поддерживает максимум 5 полей.");
      return;
    }
    const used = new Set(fields.map((field) => field.id));
    let suffix = fields.length + 1;
    while (used.has("field_" + suffix)) suffix += 1;
    setFields((current) => [...current, { ...EMPTY, id: "field_" + suffix }]);
    setStatus("");
  }

  function remove(index: number) {
    if (fields.length <= 1) {
      setStatus("Форма должна содержать хотя бы одно поле.");
      return;
    }
    setFields((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/form", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "ticket_form_save_failed");
      setFields((body.fields ?? fields) as Field[]);
      setStatus("Форма тикета сохранена.");
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить форму.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {status && <div style={notice}>{status}</div>}
      <div style={{ color: "#697486", fontSize: 10 }}>
        До 5 полей Discord Modal. Ответы сохраняются вместе с тикетом и попадают в transcript.
      </div>

      {fields.map((field, index) => (
        <div key={field.id + ":" + index} style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 8 }}>
            <label style={label}><span>ID</span><input value={field.id} maxLength={30} onChange={(e) => patch(index, { id: e.target.value })} style={input} /></label>
            <label style={label}><span>Название</span><input value={field.label} maxLength={45} onChange={(e) => patch(index, { label: e.target.value })} style={input} /></label>
            <label style={label}><span>Тип</span><select value={field.type} onChange={(e) => patch(index, { type: e.target.value as Field["type"], maxLength: e.target.value === "paragraph" ? 2000 : 100 })} style={input}><option value="short">Short</option><option value="paragraph">Paragraph</option></select></label>
            <label style={{ ...label, gridColumn: "1 / span 2" }}><span>Placeholder</span><input value={field.placeholder} maxLength={100} onChange={(e) => patch(index, { placeholder: e.target.value })} style={input} /></label>
            <label style={label}><span>Макс. длина</span><input type="number" min={1} max={4000} value={field.maxLength} onChange={(e) => patch(index, { maxLength: Number(e.target.value) })} style={input} /></label>
            <label style={check}><input type="checkbox" checked={field.required} onChange={(e) => patch(index, { required: e.target.checked })} /> Обязательно</label>
          </div>
          <button type="button" onClick={() => remove(index)} disabled={busy} style={danger}>Удалить поле</button>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button type="button" onClick={addField} disabled={busy || fields.length >= 5} style={secondary}>＋ Добавить поле</button>
        <button type="button" onClick={() => void save()} disabled={busy} style={primary}>{busy ? "Сохранение…" : "Сохранить форму"}</button>
      </div>
    </div>
  );
}

const card = { display: "grid", gap: 8, padding: 12, borderRadius: 11, border: "1px solid #232a35", background: "#0d1219" } as const;
const label = { display: "grid", gap: 4, color: "#8d98a8", fontSize: 9 } as const;
const check = { display: "flex", gap: 6, alignItems: "center", color: "#8d98a8", fontSize: 9, paddingTop: 17 } as const;
const input = { width: "100%", boxSizing: "border-box" as const, background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px" } as const;
const primary = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 11px", cursor: "pointer" } as const;
const secondary = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const danger = { ...secondary, border: "1px solid #5d3035", color: "#efacac" } as const;
const notice = { padding: "9px 11px", borderRadius: 9, background: "#171d27", border: "1px solid #2b3543", color: "#9ba6b6", fontSize: 10 } as const;
