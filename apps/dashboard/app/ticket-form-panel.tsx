"use client";

import { useEffect, useState } from "react";

type TicketSummary = {
  id: number;
  channelId: string;
  creatorId: string;
  claimedBy: string | null;
  status: "open" | "closed" | "closing";
  priority: "low" | "normal" | "high" | "urgent";
  tags: string[];
  createdAt: string;
  closedAt: string | null;
  lastActivityAt: string | null;
};

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

type Customization = {
  panelTitle: string;
  panelDescription: string;
  createButtonLabel: string;
  claimButtonLabel: string;
  closeButtonLabel: string;
};

type SlaConfig = {
  enabled: boolean;
  firstResponseMinutes: number;
  reminderMinutes: number;
  escalationMinutes: number;
  escalationRoleId: string | null;
};

const DEFAULT_CUSTOMIZATION: Customization = {
  panelTitle: "🎫 Поддержка",
  panelDescription: "Нажми кнопку ниже — Vexa откроет форму тикета.",
  createButtonLabel: "Создать тикет",
  claimButtonLabel: "Забрать",
  closeButtonLabel: "Закрыть"
};

export function TicketFormPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [customization, setCustomization] = useState<Customization>(DEFAULT_CUSTOMIZATION);
  const [sla, setSla] = useState<SlaConfig>({
    enabled: false,
    firstResponseMinutes: 30,
    reminderMinutes: 120,
    escalationMinutes: 240,
    escalationRoleId: null
  });
  const [status, setStatus] = useState("");
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [ticketFilter, setTicketFilter] = useState<"open" | "closed" | "closing" | "all">("open");
  const [ticketEdits, setTicketEdits] = useState<Record<number, { priority: TicketSummary["priority"]; tags: string }>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const ticketQuery = ticketFilter === "all" ? "" : "?status=" + ticketFilter;
    const [formResponse, customizationResponse, slaResponse, ticketsResponse] = await Promise.all([
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/form", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/customization", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/sla", { cache: "no-store" }),
      fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets" + ticketQuery, { cache: "no-store" })
    ]);
    const formBody = await formResponse.json().catch(() => ({}));
    const customizationBody = await customizationResponse.json().catch(() => ({}));
    const slaBody = await slaResponse.json().catch(() => ({}));
    const ticketsBody = await ticketsResponse.json().catch(() => ({}));
    if (!formResponse.ok) throw new Error(formBody.error ?? "ticket_form_failed");
    if (!customizationResponse.ok) throw new Error(customizationBody.error ?? "ticket_customization_failed");
    if (!slaResponse.ok) throw new Error(slaBody.error ?? "ticket_sla_failed");
    if (!ticketsResponse.ok) throw new Error(ticketsBody.error ?? "tickets_failed");
    setFields((formBody.fields ?? []) as Field[]);
    setCustomization((customizationBody.customization ?? DEFAULT_CUSTOMIZATION) as Customization);
    setSla((slaBody.sla ?? sla) as SlaConfig);
    const nextTickets = (ticketsBody.tickets ?? []) as TicketSummary[];
    setTickets(nextTickets);
    setTicketEdits(Object.fromEntries(nextTickets.map((ticket) => [
      ticket.id,
      { priority: ticket.priority, tags: ticket.tags.join(", ") }
    ])));
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить форму."));
  }, [guildId, ticketFilter]);

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

  async function saveTicketMetadata(ticket: TicketSummary) {
    const edit = ticketEdits[ticket.id] ?? { priority: ticket.priority, tags: ticket.tags.join(", ") };
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/" + ticket.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          priority: edit.priority,
          tags: edit.tags.split(",").map((value) => value.trim()).filter(Boolean)
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "ticket_metadata_save_failed");
      setStatus("Ticket #" + ticket.id + " обновлён.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Не удалось обновить ticket.");
    } finally {
      setBusy(false);
    }
  }

  function patchSla(patch: Partial<SlaConfig>) {
    setSla((current) => ({ ...current, ...patch }));
  }

  async function saveSla() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/sla", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sla)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "ticket_sla_save_failed");
      setSla((body.sla ?? sla) as SlaConfig);
      setStatus("SLA тикетов сохранён.");
      await onChanged?.();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Не удалось сохранить SLA.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomization() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/tickets/customization", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(customization)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "ticket_customization_save_failed");
      setCustomization((body.customization ?? customization) as Customization);
      setStatus("Оформление тикетов сохранено.");
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить оформление.");
    } finally {
      setBusy(false);
    }
  }

  function patchCustomization(patchValue: Partial<Customization>) {
    setCustomization((current) => ({ ...current, ...patchValue }));
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
      <section style={sectionStyle}>
        <div style={sectionTitle}>Ticket queue · priority / tags / assignment</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={ticketFilter} onChange={(e) => setTicketFilter(e.target.value as typeof ticketFilter)} style={input}>
            <option value="open">Открытые</option>
            <option value="closing">Закрывающиеся</option>
            <option value="closed">Закрытые</option>
            <option value="all">Все</option>
          </select>
          <span style={{ color: "#697486", fontSize: 10 }}>{tickets.length} tickets</span>
        </div>
        {tickets.length === 0 ? (
          <div style={{ color: "#697486", fontSize: 10 }}>В выбранном статусе тикетов нет.</div>
        ) : tickets.map((ticket) => {
          const edit = ticketEdits[ticket.id] ?? { priority: ticket.priority, tags: ticket.tags.join(", ") };
          return (
            <div key={ticket.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 11 }}>#{ticket.id}</strong>
                <span style={{ color: "#697486", fontSize: 10 }}>{ticket.status} · {new Date(ticket.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 7 }}>
                <select
                  value={edit.priority}
                  onChange={(e) => setTicketEdits((current) => ({ ...current, [ticket.id]: { ...edit, priority: e.target.value as TicketSummary["priority"] } }))}
                  style={input}
                >
                  <option value="urgent">urgent</option>
                  <option value="high">high</option>
                  <option value="normal">normal</option>
                  <option value="low">low</option>
                </select>
                <input
                  value={edit.tags}
                  maxLength={400}
                  onChange={(e) => setTicketEdits((current) => ({ ...current, [ticket.id]: { ...edit, tags: e.target.value } }))}
                  placeholder="Теги через запятую"
                  style={input}
                />
                <button type="button" disabled={busy} onClick={() => void saveTicketMetadata(ticket)} style={secondary}>Сохранить</button>
              </div>
              <div style={{ color: "#697486", fontSize: 9 }}>
                creator: {ticket.creatorId} · assigned: {ticket.claimedBy ?? "—"} · channel: {ticket.channelId}
              </div>
            </div>
          );
        })}
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Staff SLA · напоминания и эскалация</div>
        <label style={check}>
          <input type="checkbox" checked={sla.enabled} onChange={(e) => patchSla({ enabled: e.target.checked })} />
          Включить SLA worker
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <label style={label}><span>Первый ответ, минут</span><input type="number" min={1} max={10080} value={sla.firstResponseMinutes} onChange={(e) => patchSla({ firstResponseMinutes: Number(e.target.value) })} style={input} /></label>
          <label style={label}><span>Напоминание, минут</span><input type="number" min={1} max={10080} value={sla.reminderMinutes} onChange={(e) => patchSla({ reminderMinutes: Number(e.target.value) })} style={input} /></label>
          <label style={label}><span>Эскалация, минут</span><input type="number" min={1} max={20160} value={sla.escalationMinutes} onChange={(e) => patchSla({ escalationMinutes: Number(e.target.value) })} style={input} /></label>
        </div>
        <label style={label}>
          <span>Role ID для эскалации (необязательно)</span>
          <input value={sla.escalationRoleId ?? ""} maxLength={20} onChange={(e) => patchSla({ escalationRoleId: e.target.value.trim() || null })} placeholder="123456789012345678" style={input} />
        </label>
        <div style={{ color: "#697486", fontSize: 9 }}>
          Напоминание отправляется один раз: непринятым тикетам — после таймера первого ответа, принятым — после бездействия. Эскалация также одноразовая.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void saveSla()} disabled={busy} style={secondary}>{busy ? "Сохранение…" : "Сохранить SLA"}</button>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitle}>Оформление и кнопки</div>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={label}><span>Заголовок панели</span><input value={customization.panelTitle} maxLength={256} onChange={(e) => patchCustomization({ panelTitle: e.target.value })} style={input} /></label>
          <label style={label}><span>Описание панели</span><textarea value={customization.panelDescription} maxLength={1000} onChange={(e) => patchCustomization({ panelDescription: e.target.value })} style={{ ...input, minHeight: 70 }} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            <label style={label}><span>Создать</span><input value={customization.createButtonLabel} maxLength={80} onChange={(e) => patchCustomization({ createButtonLabel: e.target.value })} style={input} /></label>
            <label style={label}><span>Забрать</span><input value={customization.claimButtonLabel} maxLength={80} onChange={(e) => patchCustomization({ claimButtonLabel: e.target.value })} style={input} /></label>
            <label style={label}><span>Закрыть</span><input value={customization.closeButtonLabel} maxLength={80} onChange={(e) => patchCustomization({ closeButtonLabel: e.target.value })} style={input} /></label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => void saveCustomization()} disabled={busy} style={secondary}>{busy ? "Сохранение…" : "Сохранить оформление"}</button>
          </div>
        </div>
      </section>

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

const sectionStyle = { display: "grid", gap: 8, padding: 12, borderRadius: 11, border: "1px solid #2c3949", background: "#0b1017" } as const;
const sectionTitle = { fontSize: 11, fontWeight: 700, color: "#d7dde6" } as const;
const card = { display: "grid", gap: 8, padding: 12, borderRadius: 11, border: "1px solid #232a35", background: "#0d1219" } as const;
const label = { display: "grid", gap: 4, color: "#8d98a8", fontSize: 9 } as const;
const check = { display: "flex", gap: 6, alignItems: "center", color: "#8d98a8", fontSize: 9, paddingTop: 17 } as const;
const input = { width: "100%", boxSizing: "border-box" as const, background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px" } as const;
const primary = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 11px", cursor: "pointer" } as const;
const secondary = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const danger = { ...secondary, border: "1px solid #5d3035", color: "#efacac" } as const;
const notice = { padding: "9px 11px", borderRadius: 9, background: "#171d27", border: "1px solid #2b3543", color: "#9ba6b6", fontSize: 10 } as const;
