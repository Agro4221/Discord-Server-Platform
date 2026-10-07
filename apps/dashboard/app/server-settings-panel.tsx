"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string };
type General = {
  commandPrefix: string;
  locale: "ru" | "en";
  timezone: string;
  djRoleId: string | null;
  moderatorRoleIds: string[];
  defaultLogChannelId: string | null;
  auditLogEnabled: boolean;
};

export function ServerSettingsPanel({ guildId, roles, channels, onChanged }: {
  guildId: string;
  roles: Resource[];
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [settings, setSettings] = useState<General>({
    commandPrefix: "!", locale: "ru", timezone: "UTC", djRoleId: null,
    moderatorRoleIds: [], defaultLogChannelId: null, auditLogEnabled: false
  });
  const [moderators, setModerators] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/general", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "general_settings_failed"));
    const next = body.settings as General;
    setSettings(next);
    setModerators(next.moderatorRoleIds.join(", "));
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(formatError(reason)));
  }, [guildId]);

  async function save(patch: Partial<General>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...patch })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "general_settings_failed"));
      const next = body.settings as General;
      setSettings(next);
      setModerators(next.moderatorRoleIds.join(", "));
      await onChanged?.();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  function ids(value: string) {
    return [...new Set(value.split(/[,\s]+/).filter((id) => /^\d{15,25}$/.test(id)))].slice(0, 50);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={errorBox}>{error}</div>}
      <div style={grid}>
        <Field label="Command prefix">
          <input value={settings.commandPrefix} maxLength={3} disabled={busy} onChange={(e) => setSettings((x) => ({ ...x, commandPrefix: e.target.value }))} onBlur={() => void save({ commandPrefix: settings.commandPrefix })} style={inputStyle} />
        </Field>
        <Field label="Locale">
          <select value={settings.locale} disabled={busy} onChange={(e) => void save({ locale: e.target.value as "ru" | "en" })} style={inputStyle}><option value="ru">Русский</option><option value="en">English</option></select>
        </Field>
        <Field label="Timezone">
          <input value={settings.timezone} maxLength={64} disabled={busy} onChange={(e) => setSettings((x) => ({ ...x, timezone: e.target.value }))} onBlur={() => void save({ timezone: settings.timezone })} style={inputStyle} placeholder="UTC / Europe/Berlin / Asia/Omsk" />
        </Field>
        <Field label="DJ role">
          <select value={settings.djRoleId ?? ""} disabled={busy} onChange={(e) => void save({ djRoleId: e.target.value || null })} style={inputStyle}><option value="">Не задана</option>{roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}</select>
        </Field>
        <Field label="Default log channel">
          <select value={settings.defaultLogChannelId ?? ""} disabled={busy} onChange={(e) => void save({ defaultLogChannelId: e.target.value || null })} style={inputStyle}><option value="">Не задан</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
        </Field>
        <Field label="Moderator role IDs">
          <input value={moderators} disabled={busy} onChange={(e) => setModerators(e.target.value)} onBlur={() => void save({ moderatorRoleIds: ids(moderators) })} style={inputStyle} placeholder="ID через пробел/запятую" />
        </Field>
      </div>
      <label style={check}><input type="checkbox" checked={settings.auditLogEnabled} disabled={busy} onChange={(e) => void save({ auditLogEnabled: e.target.checked })} /> Durable audit logging</label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={field}><span>{label}</span>{children}</label>;
}

function formatError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : "general_settings_failed";
  const messages: Record<string, string> = {
    invalid_command_prefix: "Prefix: 1–3 символа из ! ? . $ % # ^ ~.",
    invalid_locale: "Поддерживаются только ru и en.",
    invalid_timezone: "Некорректный timezone."
  };
  return messages[code] ?? code;
}

const grid = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 } as const;
const field = { display: "grid", gap: 5, color: "#7c8798", fontSize: 9 } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const check = { display: "flex", alignItems: "center", gap: 8, color: "#95a0b1", fontSize: 10 } as const;
const errorBox = { padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 } as const;
