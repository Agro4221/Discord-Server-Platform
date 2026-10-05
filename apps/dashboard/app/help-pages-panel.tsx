"use client";

import { useEffect, useState } from "react";

type HelpPage = {
  slug: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: string;
};

const EMPTY = { slug: "", title: "", content: "", enabled: true };

export function HelpPagesPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [pages, setPages] = useState<HelpPage[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/help-pages", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "help_pages_failed");
    setPages((body.pages ?? []) as HelpPage[]);
  }

  useEffect(() => {
    setStatus("");
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Не удалось загрузить help pages."));
  }, [guildId]);

  function edit(page: HelpPage) {
    setDraft({
      slug: page.slug,
      title: page.title,
      content: page.content,
      enabled: page.enabled
    });
    setStatus("");
  }

  function reset() {
    setDraft(EMPTY);
    setStatus("");
  }

  async function save() {
    if (!draft.slug.trim() || !draft.title.trim() || !draft.content.trim()) {
      setStatus("Заполни slug, заголовок и текст страницы.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/help-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "help_page_save_failed");
      setDraft(EMPTY);
      setStatus("Страница помощи сохранена.");
      await load();
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось сохранить страницу.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    if (!window.confirm("Удалить help page \"" + slug + "\"?")) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/help-pages/" + encodeURIComponent(slug), { method: "DELETE" });
      if (!response.ok) throw new Error("help_page_delete_failed");
      if (draft.slug === slug) reset();
      await load();
      await onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить страницу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {status && <div style={notice}>{status}</div>}

      <section style={sectionStyle}>
        <div style={sectionTitle}>Custom Help / Menu pages</div>
        <div style={hint}>
          Создавай собственные страницы для <code>/help page:slug</code>. До 3900 символов, без выполнения команд.
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 8 }}>
            <label style={label}><span>Slug</span><input value={draft.slug} maxLength={40} onChange={(e) => setDraft((v) => ({ ...v, slug: e.target.value }))} placeholder="rules" style={input} /></label>
            <label style={label}><span>Заголовок</span><input value={draft.title} maxLength={100} onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} placeholder="Правила сервера" style={input} /></label>
            <label style={check}><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((v) => ({ ...v, enabled: e.target.checked }))} /> Visible</label>
          </div>
          <label style={label}><span>Содержание</span><textarea value={draft.content} maxLength={3900} onChange={(e) => setDraft((v) => ({ ...v, content: e.target.value }))} rows={9} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} placeholder="Markdown-like plain text..." /></label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
            <button type="button" disabled={busy} onClick={reset} style={secondary}>Очистить</button>
            <button type="button" disabled={busy} onClick={() => void save()} style={primary}>{busy ? "Сохранение…" : "Сохранить страницу"}</button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {pages.map((page) => (
            <div key={page.slug} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div>
                  <strong>{page.slug}</strong>
                  <div style={{ marginTop: 3, fontSize: 10, color: "#697486" }}>{page.title} · {page.enabled ? "visible" : "hidden"} · updated {new Date(page.updatedAt).toLocaleString()}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" disabled={busy} onClick={() => edit(page)} style={secondary}>Изменить</button>
                  <button type="button" disabled={busy} onClick={() => void remove(page.slug)} style={danger}>Удалить</button>
                </div>
              </div>
              <div style={{ whiteSpace: "pre-wrap", maxHeight: 90, overflow: "hidden", color: "#909aaa", fontSize: 10 }}>{page.content}</div>
            </div>
          ))}
          {pages.length === 0 && <div style={{ color: "#697486", fontSize: 10 }}>Своих help pages пока нет.</div>}
        </div>
      </section>
    </div>
  );
}

const sectionStyle = { display: "grid", gap: 8, padding: 12, borderRadius: 11, border: "1px solid #2c3949", background: "#0b1017" } as const;
const sectionTitle = { fontSize: 11, fontWeight: 700, color: "#d7dde6" } as const;
const card = { display: "grid", gap: 7, padding: 10, borderRadius: 9, border: "1px solid #232a35", background: "#0d1219" } as const;
const label = { display: "grid", gap: 4, color: "#8d98a8", fontSize: 9 } as const;
const check = { display: "flex", gap: 6, alignItems: "center", color: "#8d98a8", fontSize: 9, paddingTop: 17 } as const;
const input = { width: "100%", boxSizing: "border-box" as const, background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px" } as const;
const primary = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 11px", cursor: "pointer" } as const;
const secondary = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const danger = { ...secondary, border: "1px solid #5d3035", color: "#efacac" } as const;
const notice = { padding: "9px 11px", borderRadius: 9, background: "#171d27", border: "1px solid #2b3543", color: "#9ba6b6", fontSize: 10 } as const;
const hint = { color: "#697486", fontSize: 9 } as const;
