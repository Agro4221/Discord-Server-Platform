"use client";

import { useEffect, useState } from "react";

type Policy = {
  commandName: string;
  label: string;
  module: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  cooldownSeconds: number;
  allowedRoleIds: string[];
  deniedRoleIds: string[];
  allowedChannelIds: string[];
  deniedChannelIds: string[];
  helpVisible: boolean;
};

function PolicyIdsInput({
  label,
  value,
  disabled,
  onChange,
  onBlur
}: {
  label: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
  onBlur: (value: string[]) => void;
}) {
  const parse = (raw: string) => raw.split(/[\s,]+/).filter(Boolean);
  return (
    <label style={{ display: "grid", gap: 3, minWidth: 0 }}>
      <span style={{ color: "#697486", fontSize: 8 }}>{label}</span>
      <input
        value={value.join(" ")}
        disabled={disabled}
        onChange={(e) => onChange(parse(e.target.value))}
        onBlur={(e) => onBlur(parse(e.target.value))}
        placeholder="IDs через пробел"
        style={wideInputStyle}
      />
    </label>
  );
}

export function CommandPolicyPanel({ guildId }: { guildId: string }) {
  const [items, setItems] = useState<Policy[]>([]);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/command-policies", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "command_policies_failed");
    setItems((body.policies ?? []) as Policy[]);
  }

  useEffect(() => {
    setError("");
    void load().catch(() => setError("Не удалось загрузить command policies."));
  }, [guildId]);

  async function patch(commandName: string, patch: Partial<Policy>) {
    setSaving(commandName);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/command-policies/" + encodeURIComponent(commandName),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "command_policy_save_failed");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить policy.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error && <div style={errorStyle}>{error}</div>}
      {items.map((item) => (
        <div key={item.commandName} style={rowStyle}>
          <div style={{ minWidth: 180 }}>
            <strong style={{ fontSize: 11 }}>{item.label}</strong>
            <div style={{ marginTop: 2, color: "#667184", fontSize: 9 }}>/ {item.commandName} · {item.module}</div>
          </div>
          <label style={checkStyle}>
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={saving === item.commandName}
              onChange={(e) => void patch(item.commandName, { enabled: e.target.checked })}
            />
            ON
          </label>
          <label style={checkStyle}>
            <input
              type="checkbox"
              checked={item.prefixEnabled}
              disabled={saving === item.commandName}
              onChange={(e) => void patch(item.commandName, { prefixEnabled: e.target.checked })}
            />
            Prefix
          </label>
          <label style={checkStyle}>
            <input
              type="checkbox"
              checked={item.slashEnabled}
              disabled={saving === item.commandName}
              onChange={(e) => void patch(item.commandName, { slashEnabled: e.target.checked })}
            />
            Slash
          </label>
          <input
            type="number"
            min={0}
            max={86400}
            value={item.cooldownSeconds}
            disabled={saving === item.commandName}
            onChange={(e) => setItems((current) => current.map((x) => x.commandName === item.commandName ? { ...x, cooldownSeconds: Number(e.target.value) } : x))}
            onBlur={(e) => void patch(item.commandName, { cooldownSeconds: Number(e.target.value) })}
            style={inputStyle}
            title="Cooldown seconds"
          />
          <label style={checkStyle}>
            <input
              type="checkbox"
              checked={item.helpVisible}
              disabled={saving === item.commandName}
              onChange={(e) => void patch(item.commandName, { helpVisible: e.target.checked })}
            />
            Help
          </label>
          <div style={scopeGridStyle}>
            <PolicyIdsInput
              label="Allowed roles"
              value={item.allowedRoleIds}
              disabled={saving === item.commandName}
              onChange={(value) => setItems((current) => current.map((x) => x.commandName === item.commandName ? { ...x, allowedRoleIds: value } : x))}
              onBlur={(value) => void patch(item.commandName, { allowedRoleIds: value })}
            />
            <PolicyIdsInput
              label="Denied roles"
              value={item.deniedRoleIds}
              disabled={saving === item.commandName}
              onChange={(value) => setItems((current) => current.map((x) => x.commandName === item.commandName ? { ...x, deniedRoleIds: value } : x))}
              onBlur={(value) => void patch(item.commandName, { deniedRoleIds: value })}
            />
            <PolicyIdsInput
              label="Allowed channels"
              value={item.allowedChannelIds}
              disabled={saving === item.commandName}
              onChange={(value) => setItems((current) => current.map((x) => x.commandName === item.commandName ? { ...x, allowedChannelIds: value } : x))}
              onBlur={(value) => void patch(item.commandName, { allowedChannelIds: value })}
            />
            <PolicyIdsInput
              label="Denied channels"
              value={item.deniedChannelIds}
              disabled={saving === item.commandName}
              onChange={(value) => setItems((current) => current.map((x) => x.commandName === item.commandName ? { ...x, deniedChannelIds: value } : x))}
              onBlur={(value) => void patch(item.commandName, { deniedChannelIds: value })}
            />
          </div>
        </div>
      ))}
      {!items.length && !error && <div style={{ opacity: 0.4, fontSize: 11 }}>Command policies пока не загружены.</div>}
    </div>
  );
}

const rowStyle = {
  display: "grid",
  gap: 8,
  padding: "10px 0",
  borderBottom: "1px solid #202632"
} as const;

const checkStyle = {
  display: "flex",
  gap: 4,
  alignItems: "center",
  color: "#697486",
  fontSize: 9
} as const;

const inputStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box" as const,
  background: "#0d1118",
  color: "#f4f6fa",
  border: "1px solid #303846",
  borderRadius: 8,
  padding: "7px 8px"
} as const;

const wideInputStyle = { ...inputStyle };

const scopeGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
  gap: 8
} as const;

const errorStyle = {
  padding: 10,
  borderRadius: 10,
  background: "#32191b",
  border: "1px solid #63292d"
} as const;
