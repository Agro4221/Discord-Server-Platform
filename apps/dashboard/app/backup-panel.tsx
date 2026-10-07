"use client";

import { useEffect, useState } from "react";

export function BackupPanel({ guildId, onChanged }: { guildId: string; onChanged?: () => void | Promise<void> }) {
  const [backups, setBackups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!guildId) return;
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/backups", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "backups_failed");
    setBackups(body.backups ?? []);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить backups."));
  }, [guildId]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/backup", {
        method: "POST"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "backup_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать backup.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: string) {
    if (!window.confirm("Восстановить этот backup? Текущие настройки сервера будут заменены содержимым архива.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/backups/" + encodeURIComponent(file) + "/restore",
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "restore_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось восстановить backup.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: string) {
    if (!window.confirm("Удалить этот backup-файл?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/backups/" + encodeURIComponent(file),
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "delete_backup_failed");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить backup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17 }}>Резервные копии</h3>
          <div style={{ marginTop: 5, opacity: 0.45, fontSize: 12 }}>
            Резервная копия относится только к выбранному серверу. Восстановление заменяет текущую конфигурацию сервера сохранённой версией.
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void create()} style={buttonStyle("primary")}>
          Создать резервную копию
        </button>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>}

      {backups.length === 0 ? (
        <div style={{ opacity: 0.42, padding: "8px 0" }}>Резервных копий пока нет.</div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {backups.map((file) => (
            <div key={file} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1d212b" }}>
              <code style={{ fontSize: 12, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis" }}>{file}</code>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button type="button" disabled={busy} onClick={() => void restore(file)} style={buttonStyle("secondary")} >Восстановить</button>
                <button type="button" disabled={busy} onClick={() => void remove(file)} style={buttonStyle("danger")}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171a21";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303643";
  return {
    border: "1px solid " + border,
    background,
    color: "#fff",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer"
  } as const;
}
