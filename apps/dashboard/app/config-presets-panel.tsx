"use client";

import { useEffect, useState } from "react";

type Preset = {
  id: number;
  name: string;
  moduleCount: number;
  createdAt: string;
  updatedAt: string;
};

export function ConfigPresetsPanel({
  guildId,
  onChanged
}: {
  guildId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/presets", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "presets_failed"));
    setItems((body.presets ?? []) as Preset[]);
  }

  useEffect(() => {
    setError("");
    setNotice("");
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить presets."));
  }, [guildId]);

  async function save() {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized) {
      setError("Укажи название preset.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: normalized })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "preset_save_failed"));
      setName("");
      setNotice("Preset сохранён.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить preset.");
    } finally {
      setBusy(false);
    }
  }

  async function apply(id: number, presetName: string) {
    if (!window.confirm("Применить preset «" + presetName + "»? Текущая конфигурация этой guild будет заменена сохранённым снимком.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/presets/" + String(id) + "/apply",
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "preset_apply_failed"));
      setNotice("Preset «" + presetName + "» применён.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось применить preset.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, presetName: string) {
    if (!window.confirm("Удалить preset «" + presetName + "»?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/presets/" + String(id),
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "preset_delete_failed"));
      setNotice("Preset удалён.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить preset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ color: "#747f90", fontSize: 10, lineHeight: 1.5 }}>
        Именованные snapshots позволяют быстро вернуть рабочую конфигурацию. Preset применяется только к текущей guild и использует тот же ConfigTransfer contract, что и Backup/Export.
      </div>

      {(error || notice) && (
        <div style={{
          padding: 9,
          borderRadius: 9,
          border: "1px solid " + (error ? "#63292d" : "#3b8659"),
          background: error ? "#32191b" : "#173522",
          color: error ? "#f1c3c5" : "#c9f4d5",
          fontSize: 10
        }}>
          {error || notice}
        </div>
      )}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          placeholder="Название, например: Production / Community / Night"
          maxLength={80}
          style={inputStyle}
        />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} style={buttonStyle("primary")}>
          {busy ? "Сохранение…" : "Сохранить текущую конфигурацию"}
        </button>
      </div>

      {!items.length ? (
        <div style={{ padding: "8px 0", color: "#687486", fontSize: 10 }}>
          Сохранённых presets пока нет.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {items.map((preset) => (
            <article key={preset.id} style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              padding: "10px 11px",
              border: "1px solid #232a35",
              borderRadius: 10,
              background: "#0d1219",
              flexWrap: "wrap"
            }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 11 }}>{preset.name}</strong>
                <div style={{ marginTop: 3, color: "#687486", fontSize: 9 }}>
                  {preset.moduleCount} модулей · обновлён {formatDate(preset.updatedAt)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => void apply(preset.id, preset.name)} style={buttonStyle("secondary")}>Применить</button>
                <button type="button" disabled={busy} onClick={() => void remove(preset.id, preset.name)} style={buttonStyle("danger")}>Удалить</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
}

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643";
  return {
    border: "1px solid " + border,
    background,
    color: "#fff",
    borderRadius: 9,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 10
  } as const;
}

const inputStyle = {
  flex: "1 1 260px",
  minWidth: 220,
  background: "#0f151d",
  color: "#f4f6fa",
  border: "1px solid #2d3643",
  borderRadius: 9,
  padding: "9px 10px"
} as const;
