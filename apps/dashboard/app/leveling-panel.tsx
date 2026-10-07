"use client";

import { useEffect, useMemo, useState } from "react";

type Resource = { id: string; name: string; manageable?: boolean };
type Reward = {
  level: number;
  roleId: string;
  removePrevious: boolean;
  dmUser: boolean;
  message: string;
};
type Exclusion = { kind: "role" | "channel"; refId: string };

export function LevelingPanel({ guildId, roles, channels, onChanged }: {
  guildId: string;
  roles: Resource[];
  channels: Resource[];
  onChanged?: () => void | Promise<void>;
}) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [level, setLevel] = useState("5");
  const [roleId, setRoleId] = useState("");
  const [message, setMessage] = useState("");
  const [removePrevious, setRemovePrevious] = useState(true);
  const [dmUser, setDmUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);
  const activeRoleIds = useMemo(() => new Set(exclusions.filter((item) => item.kind === "role").map((item) => item.refId)), [exclusions]);
  const activeChannelIds = useMemo(() => new Set(exclusions.filter((item) => item.kind === "channel").map((item) => item.refId)), [exclusions]);

  async function load() {
    const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "leveling_failed"));
    setRewards((body.rewards ?? []) as Reward[]);
    setExclusions((body.exclusions ?? []) as Exclusion[]);
  }

  useEffect(() => {
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить Leveling."));
  }, [guildId]);

  async function saveReward() {
    const numericLevel = Number(level);
    if (!Number.isInteger(numericLevel) || numericLevel < 1 || numericLevel > 10000 || !/^\d{15,25}$/.test(roleId)) {
      setError("Укажи корректный уровень (1–10000) и роль.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling/rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: numericLevel, roleId, removePrevious, dmUser, message: message.trim() })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "level_reward_failed"));
      setRewards((body.rewards ?? []) as Reward[]);
      setMessage("");
      await onChanged?.();
    } catch (reason) {
      setError(formatLevelingError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReward(item: Reward) {
    if (!window.confirm("Удалить reward для уровня " + item.level + "?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling/rewards/" + item.level, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "level_reward_delete_failed"));
      setRewards((current) => current.filter((candidate) => candidate.level !== item.level));
      await onChanged?.();
    } catch (reason) {
      setError(formatLevelingError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleExclusion(kind: "role" | "channel", refId: string) {
    const active = kind === "role" ? activeRoleIds.has(refId) : activeChannelIds.has(refId);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, refId, enabled: !active })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "leveling_exclusion_failed"));
      setExclusions((body.exclusions ?? []) as Exclusion[]);
      await onChanged?.();
    } catch (reason) {
      setError(formatLevelingError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Базовые XP-параметры находятся в Configuration выше. Здесь управляются role rewards и исключения из начисления XP.
      </div>
      {error && <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 }}>{error}</div>}

      <section style={panel}>
        <div style={label}>LEVEL REWARD</div>
        <div style={{ display: "grid", gridTemplateColumns: "100px minmax(180px,1fr) minmax(170px,1fr)", gap: 8, marginTop: 9 }}>
          <input value={level} onChange={(event) => setLevel(event.target.value)} type="number" min={1} max={10000} style={inputStyle} placeholder="Level" />
          <select value={roleId} onChange={(event) => setRoleId(event.target.value)} style={inputStyle}>
            <option value="">Роль за уровень…</option>
            {roles.filter((role) => role.manageable !== false).map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
          </select>
          <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} placeholder="Сообщение при повышении" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 9 }}>
          <label style={checkbox}><input type="checkbox" checked={removePrevious} onChange={(event) => setRemovePrevious(event.target.checked)} /> Снимать предыдущую роль</label>
          <label style={checkbox}><input type="checkbox" checked={dmUser} onChange={(event) => setDmUser(event.target.checked)} /> Отправлять в ЛС</label>
          <div style={{ flex: 1 }} />
          <button type="button" disabled={busy} onClick={() => void saveReward()} style={button("primary")}>{busy ? "Сохраняем…" : "Сохранить reward"}</button>
        </div>
      </section>

      <section style={panel}>
        <div style={label}>REWARDS</div>
        {rewards.length === 0 ? <div style={muted}>Rewards пока не настроены.</div> : rewards.map((item) => (
          <div key={item.level} style={row}>
            <strong>Lv. {item.level}</strong>
            <span style={muted}>@{roleNames.get(item.roleId) ?? item.roleId}</span>
            <span style={muted}>{item.removePrevious ? "replace" : "stack"} · {item.dmUser ? "DM" : "no DM"}</span>
            <button type="button" disabled={busy} onClick={() => void deleteReward(item)} style={button("danger")}>Удалить</button>
          </div>
        ))}
      </section>

      <section style={panel}>
        <div style={label}>EXCLUSIONS</div>
        <div style={{ display: "grid", gap: 10 }}>
          <ResourceGroup title="Роли" items={roles} active={activeRoleIds} prefix="@" busy={busy} onToggle={(id) => void toggleExclusion("role", id)} />
          <ResourceGroup title="Каналы" items={channels} active={activeChannelIds} prefix="#" busy={busy} onToggle={(id) => void toggleExclusion("channel", id)} />
        </div>
      </section>
    </div>
  );
}

function ResourceGroup({ title, items, active, prefix, busy, onToggle }: {
  title: string;
  items: Resource[];
  active: Set<string>;
  prefix: string;
  busy: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div style={subhead}>{title}</div>
      {items.length === 0 ? <div style={muted}>Нет доступных ресурсов.</div> : items.map((item) => (
        <button key={item.id} type="button" disabled={busy} onClick={() => onToggle(item.id)} style={{ ...row, width: "100%", border: "1px solid #1d2530", background: "#0b1016", color: "#d8dee8", textAlign: "left", cursor: "pointer" }}>
          <span>{prefix}{item.name}</span>
          <span style={{ marginLeft: "auto", color: active.has(item.id) ? "#79ba91" : "#5e6979", fontSize: 10 }}>{active.has(item.id) ? "EXCLUDED" : "ALLOW"}</span>
        </button>
      ))}
    </div>
  );
}

function formatLevelingError(error: unknown): string {
  const code = error instanceof Error ? error.message : "leveling_failed";
  const messages: Record<string, string> = {
    leveling_disabled: "Модуль Leveling выключен.",
    reward_role_not_manageable: "Эта роль недоступна боту по Discord hierarchy.",
    invalid_reward_level: "Некорректный уровень reward.",
    invalid_reward_role: "Некорректный role ID.",
    invalid_exclusion_ref: "Некорректный ID ресурса."
  };
  return messages[code] ?? code;
}

const panel = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const button = (kind: "primary" | "secondary" | "danger") => ({ border: "1px solid " + (kind === "danger" ? "#79343c" : "#303846"), background: kind === "danger" ? "#4b2227" : kind === "primary" ? "#253c5e" : "#171c25", color: "#f5f7fa", borderRadius: 9, padding: "9px 12px", cursor: "pointer" } as const);
const row = { display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderBottom: "1px solid #1d232d", fontSize: 11 } as const;
const label = { color: "#687486", fontSize: 9, letterSpacing: 1.2 } as const;
const subhead = { color: "#aeb7c4", fontSize: 10, margin: "9px 0 4px" } as const;
const muted = { color: "#687386", fontSize: 10 } as const;
const checkbox = { display: "flex", alignItems: "center", gap: 7, color: "#95a0b1", fontSize: 10 } as const;
