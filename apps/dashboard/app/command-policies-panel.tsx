"use client";

import { useEffect, useMemo, useState } from "react";

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
  defaultPrefix: boolean;
  defaultSlash: boolean;
};

type Resource = { id: string; name: string };

export function CommandPoliciesPanel({ guildId, roles, channels, onChanged }: {
  guildId: string;
  roles: Resource[];
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [filter, setFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/command-policies", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "command_policies_failed"));
    setPolicies((body.policies ?? []) as Policy[]);
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Command Policies."));
  }, [guildId]);

  async function save(commandName: string, patch: Partial<Policy>) {
    setBusy(commandName);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/command-policies/" + encodeURIComponent(commandName), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "command_policy_update_failed"));
      const next = body.policy as Policy | undefined;
      if (next) setPolicies((current) => current.map((item) => item.commandName === commandName ? next : item));
      else await load();
      await onChanged?.();
    } catch (reason) {
      setError(formatPolicyError(reason));
    } finally {
      setBusy("");
    }
  }

  const modules = useMemo(() => [...new Set(policies.map((policy) => policy.module))].sort(), [policies]);
  const filtered = policies.filter((policy) => {
    if (moduleFilter !== "all" && policy.module !== moduleFilter) return false;
    const needle = filter.trim().toLocaleLowerCase();
    return !needle || (policy.commandName + " " + policy.label + " " + policy.module).toLocaleLowerCase().includes(needle);
  });
  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);
  const channelNames = useMemo(() => new Map(channels.map((channel) => [channel.id, channel.name])), [channels]);

  return (
    <div style={{ display: "grid", gap: 13 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Политика применяется Core одинаково для slash и prefix-входов.
      </div>
      {error && <div style={errorBox}>{error}</div>}

      <section style={panel}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 160px", gap: 8 }}>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Поиск команды…" style={inputStyle} />
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} style={inputStyle}>
            <option value="all">Все модули</option>
            {modules.map((module) => <option key={module} value={module}>{module}</option>)}
          </select>
        </div>
      </section>

      <section style={panel}>
        <div style={headRow}>
          <span style={label}>COMMAND</span><span style={label}>ENABLED</span><span style={label}>PREFIX</span>
          <span style={label}>SLASH</span><span style={label}>COOLDOWN</span><span style={label}>HELP</span><span />
        </div>

        {filtered.map((policy) => {
          const open = expanded === policy.commandName;
          return (
            <div key={policy.commandName} style={{ borderTop: "1px solid #1d232d" }}>
              <div style={row}>
                <div>
                  <div style={{ color: "#d7ddea", fontSize: 11 }}>{policy.label}</div>
                  <div style={{ color: "#596678", fontSize: 9, marginTop: 2 }}>{policy.commandName} · {policy.module}</div>
                </div>
                <Toggle checked={policy.enabled} disabled={busy === policy.commandName} onChange={(value) => void save(policy.commandName, { enabled: value })} />
                <Toggle checked={policy.prefixEnabled} disabled={!policy.defaultPrefix || busy === policy.commandName} onChange={(value) => void save(policy.commandName, { prefixEnabled: value })} />
                <Toggle checked={policy.slashEnabled} disabled={!policy.defaultSlash || busy === policy.commandName} onChange={(value) => void save(policy.commandName, { slashEnabled: value })} />
                <input
                  type="number" min={0} max={86400} value={policy.cooldownSeconds}
                  disabled={busy === policy.commandName}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value >= 0 && value <= 86400) {
                      setPolicies((current) => current.map((item) => item.commandName === policy.commandName ? { ...item, cooldownSeconds: value } : item));
                    }
                  }}
                  onBlur={(event) => void save(policy.commandName, { cooldownSeconds: Number(event.target.value) })}
                  style={{ ...inputStyle, width: 85 }}
                />
                <Toggle checked={policy.helpVisible} disabled={busy === policy.commandName} onChange={(value) => void save(policy.commandName, { helpVisible: value })} />
                <button type="button" onClick={() => setExpanded(open ? null : policy.commandName)} style={linkButton}>{open ? "Свернуть" : "Scopes"}</button>
              </div>
              {open && (
                <ScopeEditor
                  policy={policy}
                  roles={roles}
                  channels={channels}
                  roleNames={roleNames}
                  channelNames={channelNames}
                  disabled={busy === policy.commandName}
                  onSave={(patch) => void save(policy.commandName, patch)}
                />
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div style={muted}>Команды не найдены.</div>}
      </section>
    </div>
  );
}

function ScopeEditor({ policy, roles, channels, roleNames, channelNames, disabled, onSave }: {
  policy: Policy;
  roles: Resource[];
  channels: Resource[];
  roleNames: Map<string, string>;
  channelNames: Map<string, string>;
  disabled: boolean;
  onSave: (patch: Partial<Policy>) => void;
}) {
  const [allowedRoles, setAllowedRoles] = useState(policy.allowedRoleIds.join(", "));
  const [deniedRoles, setDeniedRoles] = useState(policy.deniedRoleIds.join(", "));
  const [allowedChannels, setAllowedChannels] = useState(policy.allowedChannelIds.join(", "));
  const [deniedChannels, setDeniedChannels] = useState(policy.deniedChannelIds.join(", "));

  useEffect(() => {
    setAllowedRoles(policy.allowedRoleIds.join(", "));
    setDeniedRoles(policy.deniedRoleIds.join(", "));
    setAllowedChannels(policy.allowedChannelIds.join(", "));
    setDeniedChannels(policy.deniedChannelIds.join(", "));
  }, [policy.commandName, policy.allowedRoleIds, policy.deniedRoleIds, policy.allowedChannelIds, policy.deniedChannelIds]);

  function ids(value: string) {
    return [...new Set(value.split(/[,\s]+/).map((item) => item.trim()).filter((item) => /^\d{15,25}$/.test(item)))].slice(0, 100);
  }

  function apply() {
    onSave({
      allowedRoleIds: ids(allowedRoles),
      deniedRoleIds: ids(deniedRoles),
      allowedChannelIds: ids(allowedChannels),
      deniedChannelIds: ids(deniedChannels)
    });
  }

  return (
    <div style={{ padding: "12px 0 14px", display: "grid", gap: 9 }}>
      <div style={{ color: "#596678", fontSize: 9 }}>ID через пробел или запятую. Пустое поле снимает ограничение.</div>
      <ScopeField label="Разрешённые роли" value={allowedRoles} onChange={setAllowedRoles} disabled={disabled} names={roleNames} resources={roles} />
      <ScopeField label="Запрещённые роли" value={deniedRoles} onChange={setDeniedRoles} disabled={disabled} names={roleNames} resources={roles} />
      <ScopeField label="Разрешённые каналы" value={allowedChannels} onChange={setAllowedChannels} disabled={disabled} names={channelNames} resources={channels} />
      <ScopeField label="Запрещённые каналы" value={deniedChannels} onChange={setDeniedChannels} disabled={disabled} names={channelNames} resources={channels} />
      <button type="button" disabled={disabled} onClick={apply} style={buttonStyle}>Сохранить scopes</button>
    </div>
  );
}

function ScopeField({ label, value, onChange, disabled, resources, names }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  resources: Resource[];
  names: Map<string, string>;
}) {
  const hints = resources.slice(0, 8).map((item) => item.name + "=" + item.id).join(" · ");
  const resolved = value.split(/[,\s]+/).map((id) => names.get(id)).filter(Boolean).slice(0, 8).join(" · ");
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ color: "#7c8798", fontSize: 9 }}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder="Discord IDs…" title={hints} style={inputStyle} />
      {resolved && <span style={{ color: "#566173", fontSize: 8 }}>{resolved}</span>}
    </label>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} aria-pressed={checked} style={{
      width: 46, border: "1px solid " + (checked ? "#405d87" : "#303846"),
      background: checked ? "#253c5e" : "#171c25", color: "#dce3ee", borderRadius: 8, padding: "5px 0", fontSize: 9
    }}>
      {checked ? "ON" : "OFF"}
    </button>
  );
}

function formatPolicyError(error: unknown): string {
  const code = error instanceof Error ? error.message : "command_policy_update_failed";
  const messages: Record<string, string> = {
    unknown_command: "Такой команды нет в каталоге.",
    guild_not_found: "Сервер не найден."
  };
  return messages[code] ?? code;
}

const panel = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const buttonStyle = { border: "1px solid #303846", background: "#171c25", color: "#f5f7fa", borderRadius: 9, padding: "8px 11px", cursor: "pointer" } as const;
const linkButton = { ...buttonStyle, fontSize: 9, whiteSpace: "nowrap" as const };
const headRow = { display: "grid", gridTemplateColumns: "minmax(220px,1fr) 58px 58px 58px 85px 55px 65px", gap: 7, alignItems: "center", paddingBottom: 9 } as const;
const row = { display: "grid", gridTemplateColumns: "minmax(220px,1fr) 58px 58px 58px 85px 55px 65px", gap: 7, alignItems: "center", padding: "9px 0" } as const;
const label = { color: "#687486", fontSize: 8, letterSpacing: 1.1 } as const;
const muted = { color: "#687386", fontSize: 10 } as const;
const errorBox = { padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 } as const;
