"use client";

import { useEffect, useState } from "react";

type Role = {
  id: string;
  name: string;
  manageable?: boolean;
};

type Reward = {
  level: number;
  roleId: string;
  removePrevious: boolean;
  dmUser: boolean;
  message: string;
};

export function LevelingRewardsPanel({ guildId, roles, onChanged }: {
  guildId: string;
  roles: Role[];
  onChanged?: () => void | Promise<void>;
}) {
  const manageableRoles = roles.filter((role) => role.manageable !== false);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [form, setForm] = useState<Reward>({ level: 5, roleId: manageableRoles[0]?.id ?? "", removePrevious: true, dmUser: false, message: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "leveling_load_failed");
      setRewards(Array.isArray(body.rewards) ? body.rewards : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить rewards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [guildId]);

  useEffect(() => {
    if (!form.roleId && manageableRoles[0]) setForm((current) => ({ ...current, roleId: manageableRoles[0].id }));
  }, [manageableRoles.length]);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling/rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          level: Math.trunc(form.level),
          roleId: form.roleId,
          removePrevious: form.removePrevious,
          dmUser: form.dmUser,
          message: form.message
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "level_reward_save_failed");
      setRewards(Array.isArray(body.rewards) ? body.rewards : rewards);
      setNotice("Награда за уровень сохранена.");
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить reward.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(level: number) {
    if (!window.confirm("Удалить reward для уровня " + level + "?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/leveling/rewards/" + level, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "level_reward_delete_failed");
      setRewards((current) => current.filter((reward) => reward.level !== level));
      setNotice("Награда удалена.");
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить reward.");
    } finally {
      setBusy(false);
    }
  }

  function edit(reward: Reward) {
    setForm(reward);
    setNotice("Reward " + reward.level + " загружен в форму.");
    setError("");
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error && <div style={errorStyle}>{error}</div>}
      {notice && <div style={noticeStyle}>{notice}</div>}
      <div style={hintStyle}>Награда срабатывает при достижении уровня. Роль проверяется сервером на hierarchy; можно снять предыдущие level-роли и отправить персональное ЛС.</div>

      {loading ? (
        <div style={muted}>Загрузка rewards…</div>
      ) : rewards.length ? (
        <div style={{ display: "grid", gap: 7 }}>
          {rewards.map((reward) => (
            <div key={reward.level} style={card}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={badge}>{reward.level}</div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 11 }}>Уровень {reward.level}</strong>
                  <div style={muted}>{roles.find((role) => role.id === reward.roleId)?.name ?? reward.roleId}</div>
                  <div style={{ color: "#657183", fontSize: 9 }}>
                    {reward.removePrevious ? "снимает предыдущие" : "сохраняет предыдущие"}{" · "}{reward.dmUser ? "DM включён" : "DM выключен"}{reward.message ? " · milestone message задан" : ""}
                  </div>
                </div>
                <button type="button" disabled={busy} onClick={() => edit(reward)} style={secondary}>Изменить</button>
                <button type="button" disabled={busy} onClick={() => void remove(reward.level)} style={danger}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...card, opacity: 0.55 }}>Наград пока нет.</div>
      )}

      <section style={card}>
        <div style={sectionTitle}>{rewards.some((reward) => reward.level === form.level) ? "Изменить reward" : "Новая reward"}</div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: 8 }}>
            <label style={label}>
              <span>Уровень</span>
              <input type="number" min={1} max={10000} step={1} value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: Number(event.target.value) }))} style={input} disabled={busy} />
            </label>
            <label style={label}>
              <span>Роль</span>
              <select value={form.roleId} onChange={(event) => setForm((current) => ({ ...current, roleId: event.target.value }))} style={input} disabled={busy}>
                <option value="">Выбери роль</option>
                {manageableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label style={check}><input type="checkbox" checked={form.removePrevious} onChange={(event) => setForm((current) => ({ ...current, removePrevious: event.target.checked }))} disabled={busy} /> Снимать предыдущие level-роли</label>
            <label style={check}><input type="checkbox" checked={form.dmUser} onChange={(event) => setForm((current) => ({ ...current, dmUser: event.target.checked }))} disabled={busy} /> Отправить DM</label>
          </div>
          <label style={label}>
            <span>Milestone message <small>(поддерживает {`{level}`})</small></span>
            <textarea maxLength={1000} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} style={{ ...input, minHeight: 70, resize: "vertical" }} disabled={busy} placeholder="Поздравляем! Ты достиг уровня {level}." />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" disabled={busy || !form.roleId || !Number.isInteger(form.level) || form.level < 1} onClick={() => void save()} style={primary}>{busy ? "Сохранение…" : "Сохранить reward"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

const card = { padding: 10, border: "1px solid #232a35", borderRadius: 10, background: "#0e131a" } as const;
const sectionTitle = { fontSize: 12, fontWeight: 700, marginBottom: 8 } as const;
const label = { display: "grid", gap: 4, color: "#8791a0", fontSize: 9 } as const;
const check = { display: "flex", gap: 6, alignItems: "center", color: "#b7c0cc", fontSize: 10 } as const;
const input = { background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px", width: "100%", boxSizing: "border-box" as const } as const;
const primary = { border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 10px", cursor: "pointer" } as const;
const secondary = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const danger = { ...secondary, color: "#f0a7aa" } as const;
const muted = { color: "#697486", fontSize: 9 } as const;
const hintStyle = { color: "#697486", fontSize: 9, lineHeight: 1.5, padding: "7px 9px", borderRadius: 9, background: "#0c1118" } as const;
const badge = { width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "#18253a", color: "#9ec6ff", fontWeight: 800, fontSize: 12 } as const;
const errorStyle = { padding: 9, borderRadius: 9, border: "1px solid #63292d", background: "#32191b", color: "#f1c3c5", fontSize: 10 } as const;
const noticeStyle = { padding: 9, borderRadius: 9, border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", fontSize: 10 } as const;