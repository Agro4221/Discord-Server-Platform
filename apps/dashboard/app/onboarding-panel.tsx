"use client";

import { useEffect, useState } from "react";

type Resource = { id: string; name: string; type?: number; manageable?: boolean };
type OnboardingTrigger = "member.join" | "verification.passed";
type OnboardingStep =
  | { type: "role"; roleId: string }
  | { type: "channel-message"; channelId: string; content: string }
  | { type: "dm"; content: string };
type Flow = { enabled: boolean; trigger: OnboardingTrigger; steps: OnboardingStep[] };

export function OnboardingPanel({
  guildId,
  channels,
  roles,
  onChanged
}: {
  guildId: string;
  channels: Resource[];
  roles: Resource[];
  onChanged: () => void;
}) {
  const textChannels = channels.filter((channel) => channel.type === 0);
  const manageableRoles = roles.filter((role) => role.manageable !== false);
  const [flow, setFlow] = useState<Flow>({ enabled: false, trigger: "member.join", steps: [] });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/guilds/" + encodeURIComponent(guildId) + "/onboarding", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(body.error ?? "onboarding_load_failed"));
        return body.flow as Flow;
      })
      .then((next) => {
        if (!cancelled && next) setFlow({
          enabled: Boolean(next.enabled),
          trigger: next.trigger === "verification.passed" ? "verification.passed" : "member.join",
          steps: Array.isArray(next.steps) ? next.steps : []
        });
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить onboarding.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [guildId]);

  function updateStep(index: number, next: OnboardingStep) {
    setFlow((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? next : step)
    }));
  }

  function addRoleStep() {
    const roleId = manageableRoles.find((role) => !flow.steps.some((step) => step.type === "role" && step.roleId === role.id))?.id;
    if (!roleId || flow.steps.length >= 10) return;
    setFlow((current) => ({ ...current, steps: [...current.steps, { type: "role", roleId }] }));
  }

  function addChannelStep() {
    const channelId = textChannels[0]?.id;
    if (!channelId || flow.steps.length >= 10) return;
    setFlow((current) => ({
      ...current,
      steps: [...current.steps, { type: "channel-message", channelId, content: "Добро пожаловать, {mention}!" }]
    }));
  }

  function addDmStep() {
    if (flow.steps.length >= 10) return;
    setFlow((current) => ({
      ...current,
      steps: [...current.steps, { type: "dm", content: "Добро пожаловать на {server}!" }]
    }));
  }

  function removeStep(index: number) {
    setFlow((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }));
  }

  function moveStep(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= flow.steps.length) return;
    setFlow((current) => {
      const steps = [...current.steps];
      const moved = steps.splice(index, 1)[0];
      if (moved) steps.splice(target, 0, moved);
      return { ...current, steps };
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/onboarding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(flow)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "onboarding_save_failed"));
      setFlow((current) => (body.flow as Flow | undefined) ?? current);
      setNotice("Onboarding flow сохранён.");
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить onboarding.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={errorStyle}>{error}</div>}
      {notice && <div style={noticeStyle}>{notice}</div>}

      {loading ? (
        <div style={{ opacity: 0.5 }}>Загрузка onboarding…</div>
      ) : (
        <>
          <section style={boxStyle}>
            <div style={titleRow}>
              <div>
                <div style={eyebrow}>FLOW SETTINGS</div>
                <strong style={{ fontSize: 13 }}>Триггер и состояние</strong>
              </div>
              <label style={toggleLabel}>
                <input
                  type="checkbox"
                  checked={flow.enabled}
                  disabled={busy}
                  onChange={(event) => setFlow((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Включён
              </label>
            </div>

            <label style={fieldLabel}>
              <span>Запускать flow</span>
              <select
                value={flow.trigger}
                disabled={busy}
                onChange={(event) => setFlow((current) => ({
                  ...current,
                  trigger: event.target.value === "verification.passed" ? "verification.passed" : "member.join"
                }))}
                style={inputStyle}
              >
                <option value="member.join">При входе участника</option>
                <option value="verification.passed">После успешной Verification</option>
              </select>
            </label>

            <div style={{ color: "#697486", fontSize: 9, lineHeight: 1.5 }}>
              Flow выполняет только выбранные ниже шаги и не дублирует Welcome/Verification/Roles.
            </div>
          </section>

          <section style={{ display: "grid", gap: 8 }}>
            <div style={titleRow}>
              <div>
                <div style={eyebrow}>STEPS</div>
                <strong style={{ fontSize: 13 }}>Шаги потока</strong>
              </div>
              <span style={{ color: "#5e6878", fontSize: 9 }}>{flow.steps.length}/10</span>
            </div>

            {!flow.steps.length && <div style={{ ...boxStyle, opacity: 0.55 }}>Шагов пока нет. Добавь роль, сообщение в канал или ЛС.</div>}

            {flow.steps.map((step, index) => (
              <article key={index} style={boxStyle}>
                <div style={titleRow}>
                  <strong style={{ fontSize: 11 }}>#{index + 1} · {step.type === "role" ? "Роль" : step.type === "channel-message" ? "Сообщение в канал" : "Личное сообщение"}</strong>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button type="button" disabled={busy || index === 0} onClick={() => moveStep(index, -1)} style={smallButton}>↑</button>
                    <button type="button" disabled={busy || index === flow.steps.length - 1} onClick={() => moveStep(index, 1)} style={smallButton}>↓</button>
                    <button type="button" disabled={busy} onClick={() => removeStep(index)} style={dangerButton}>Удалить</button>
                  </div>
                </div>

                {step.type === "role" && (
                  <label style={fieldLabel}>
                    <span>Роль</span>
                    <select
                      value={step.roleId}
                      disabled={busy}
                      onChange={(event) => updateStep(index, { type: "role", roleId: event.target.value })}
                      style={inputStyle}
                    >
                      {manageableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </label>
                )}

                {step.type === "channel-message" && (
                  <>
                    <label style={fieldLabel}>
                      <span>Канал</span>
                      <select
                        value={step.channelId}
                        disabled={busy}
                        onChange={(event) => updateStep(index, { ...step, channelId: event.target.value })}
                        style={inputStyle}
                      >
                        {textChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                      </select>
                    </label>
                    <label style={fieldLabel}>
                      <span>Сообщение</span>
                      <textarea
                        value={step.content}
                        disabled={busy}
                        maxLength={2000}
                        onChange={(event) => updateStep(index, { ...step, content: event.target.value })}
                        style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                      />
                    </label>
                  </>
                )}

                {step.type === "dm" && (
                  <label style={fieldLabel}>
                    <span>Сообщение ЛС</span>
                    <textarea
                      value={step.content}
                      disabled={busy}
                      maxLength={2000}
                      onChange={(event) => updateStep(index, { ...step, content: event.target.value })}
                      style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                    />
                  </label>
                )}
              </article>
            ))}
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" disabled={busy || flow.steps.length >= 10 || !manageableRoles.length} onClick={addRoleStep} style={secondaryButton}>+ Роль</button>
            <button type="button" disabled={busy || flow.steps.length >= 10 || !textChannels.length} onClick={addChannelStep} style={secondaryButton}>+ Сообщение</button>
            <button type="button" disabled={busy || flow.steps.length >= 10} onClick={addDmStep} style={secondaryButton}>+ ЛС</button>
            <button type="button" disabled={busy} onClick={() => void save()} style={primaryButton}>{busy ? "Сохранение…" : "Сохранить flow"}</button>
          </div>
        </>
      )}
    </div>
  );
}

const boxStyle = {
  display: "grid", gap: 8, padding: 11, border: "1px solid #232a35",
  borderRadius: 11, background: "#0e131a"
} as const;
const titleRow = {
  display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center"
} as const;
const eyebrow = { color: "#536074", fontSize: 9, letterSpacing: 1.2 } as const;
const fieldLabel = { display: "grid", gap: 4, color: "#8791a0", fontSize: 9 } as const;
const toggleLabel = { display: "flex", gap: 6, alignItems: "center", fontSize: 10, color: "#cbd2dc" } as const;
const inputStyle = {
  background: "#0f151d", color: "#f4f6fa", border: "1px solid #2d3643", borderRadius: 8, padding: "8px 9px"
} as const;
const primaryButton = {
  border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", borderRadius: 8, padding: "8px 10px", cursor: "pointer"
} as const;
const secondaryButton = {
  border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer"
} as const;
const smallButton = {
  border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 7, padding: "4px 7px", cursor: "pointer"
} as const;
const dangerButton = { ...smallButton, color: "#f0a7aa" } as const;
const errorStyle = {
  padding: 9, borderRadius: 9, border: "1px solid #63292d", background: "#32191b", color: "#f1c3c5", fontSize: 10
} as const;
const noticeStyle = {
  padding: 9, borderRadius: 9, border: "1px solid #3b8659", background: "#173522", color: "#c9f4d5", fontSize: 10
} as const;
