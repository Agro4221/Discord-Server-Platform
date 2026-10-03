"use client";

import { useEffect, useMemo, useState } from "react";

type Member = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  manageable: boolean;
  bannable: boolean;
  moderatable: boolean;
};

type ModerationCase = {
  id: number;
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  action: "warn" | "timeout" | "kick" | "ban" | "unban";
  reason: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type Action = ModerationCase["action"];

const ACTION_LABELS: Record<Action, string> = {
  warn: "Warn",
  timeout: "Timeout",
  kick: "Kick",
  ban: "Ban",
  unban: "Unban"
};

export function ModerationPanel({
  guildId,
  channels,
  onChanged
}: {
  guildId: string;
  channels: Array<{ id: string; name: string; type?: number }>;
  onChanged?: () => void | Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [action, setAction] = useState<Action>("warn");
  const [duration, setDuration] = useState("10");
  const [reason, setReason] = useState("");
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [historyAction, setHistoryAction] = useState<"all" | Action>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channelAction, setChannelAction] = useState<"clear" | "slowmode" | "lock" | "unlock">("clear");
  const [channelValue, setChannelValue] = useState("10");

  const selectedMember = useMemo(
    () => members.find((member) => member.id === targetUserId) ?? null,
    [members, targetUserId]
  );

  async function loadMembers(query = "") {
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/members?limit=100&search=" + encodeURIComponent(query),
      { cache: "no-store" }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "members_failed"));
    setMembers((body.members ?? []) as Member[]);
  }

  async function loadHistory() {
    const suffix = historyAction === "all" ? "" : "&action=" + encodeURIComponent(historyAction);
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/history?limit=100" + suffix,
      { cache: "no-store" }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(body.error ?? "moderation_history_failed"));
    setCases((body.cases ?? []) as ModerationCase[]);
  }

  useEffect(() => {
    setError("");
    setTargetUserId("");
    void Promise.all([loadMembers(), loadHistory()]).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить модерацию.");
    });
  }, [guildId]);

  useEffect(() => {
    if (!guildId) return;
    const timer = window.setTimeout(() => {
      void loadMembers(search).catch(() => setError("Не удалось найти участников."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [guildId, search]);

  useEffect(() => {
    void loadHistory().catch(() => setError("Не удалось обновить историю модерации."));
  }, [guildId, historyAction]);

  async function execute() {
    if (!targetUserId || !/^\d{15,25}$/.test(targetUserId)) {
      setError("Выбери участника или укажи корректный Discord ID.");
      return;
    }

    if (action !== "unban" && !selectedMember) {
      setError("Участник не найден в текущем списке сервера.");
      return;
    }

    if ((action === "kick" || action === "timeout") && selectedMember && !selectedMember.moderatable) {
      setError("Discord не позволяет этому боту применить выбранное действие к участнику.");
      return;
    }

    if (action === "ban" && selectedMember && !selectedMember.bannable) {
      setError("Discord не позволяет этому боту заблокировать участника.");
      return;
    }

    const durationMinutes = action === "timeout" || action === "ban" ? Number(duration) : undefined;
    if (durationMinutes !== undefined &&
        (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320)) {
      setError("Срок должен быть целым числом от 1 до 40320 минут.");
      return;
    }

    const label = ACTION_LABELS[action];
    if ((action === "ban" || action === "kick") &&
        !window.confirm("Выполнить " + label + " для " + (selectedMember?.displayName ?? targetUserId) + "?")) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/moderation",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            targetUserId,
            reason: reason.trim(),
            ...(durationMinutes === undefined ? {} : { durationMinutes })
          })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "moderation_action_failed"));
      setReason("");
      await loadHistory();
      await onChanged?.();
    } catch (caught) {
      setError(formatModerationError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function channelExecute() {
    if (!channelId) {
      setError("Выбери текстовый канал.");
      return;
    }
    const value = channelAction === "clear" || channelAction === "slowmode" ? Number(channelValue) : undefined;
    if (value !== undefined && !Number.isInteger(value)) {
      setError("Укажи целое числовое значение.");
      return;
    }
    if ((channelAction === "clear" || channelAction === "lock") && !window.confirm("Выполнить " + channelAction + " для выбранного канала?")) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: channelAction, channelId, ...(value === undefined ? {} : { value }) })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "moderation_channel_failed"));
      await onChanged?.();
    } catch (reason) {
      setError(formatModerationError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resolveCase(item: ModerationCase) {
    if (!window.confirm("Закрыть moderation case #" + item.id + "?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/cases/" + item.id,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolved: true })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "moderation_case_resolve_failed"));
      await loadHistory();
      await onChanged?.();
    } catch (caught) {
      setError(formatModerationError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 15 }}>
      <div style={{ color: "#707b8d", fontSize: 11, lineHeight: 1.55 }}>
        Все Discord-проверки прав и иерархии выполняются на стороне Core. Это оперативный интерфейс поверх того же moderation API.
      </div>

      {error && (
        <div style={{ padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d", color: "#f0b9be", fontSize: 11 }}>
          {error}
        </div>
      )}

      <section style={panel}>
        <div style={{ fontSize: 9, letterSpacing: 1.2, color: "#687486" }}>ACTION</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 130px 120px", gap: 8, marginTop: 9 }}>
          <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} style={inputStyle}>
            <option value="">Выбрать участника…</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName} (@{member.username})
              </option>
            ))}
          </select>
          <select value={action} onChange={(event) => setAction(event.target.value as Action)} style={inputStyle}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            type="number"
            min={1}
            max={40320}
            disabled={action !== "timeout" && action !== "ban"}
            placeholder="Минут"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) minmax(220px,1.2fr)", gap: 8, marginTop: 9 }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск участника…"
            style={inputStyle}
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            placeholder="Причина"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => void execute()} style={button("primary")}>
            {busy ? "Выполняем…" : "Применить"}
          </button>
          <span style={{ color: "#647082", fontSize: 10 }}>
            {selectedMember ? selectedMember.id + " · " + (selectedMember.manageable ? "manageable" : "protected") : "Для unban можно использовать ID из поля ниже."}
          </span>
        </div>

        <input
          value={targetUserId}
          onChange={(event) => setTargetUserId(event.target.value)}
          inputMode="numeric"
          placeholder="Или Discord ID пользователя"
          style={{ ...inputStyle, marginTop: 9 }}
        />
      </section>

      <section style={channelStyle}>
        <div style={{ fontSize: 9, letterSpacing: 1.2, color: "#687486" }}>CHANNEL OPERATIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) 120px 110px auto", gap: 8, marginTop: 9 }}>
          <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
            <option value="">Текстовый канал…</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
          <select value={channelAction} onChange={(event) => setChannelAction(event.target.value as typeof channelAction)} style={inputStyle}>
            <option value="clear">Clear</option>
            <option value="slowmode">Slowmode</option>
            <option value="lock">Lock</option>
            <option value="unlock">Unlock</option>
          </select>
          <input type="number" value={channelValue} min={0} max={21600} disabled={channelAction !== "clear" && channelAction !== "slowmode"} onChange={(event) => setChannelValue(event.target.value)} placeholder="Значение" style={inputStyle} />
          <button type="button" disabled={busy} onClick={() => void channelExecute()} style={button("secondary")}>Выполнить</button>
        </div>
      </section>

      <section style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1.2, color: "#687486" }}>CASE JOURNAL</div>
            <h3 style={{ margin: "4px 0 0", fontSize: 15 }}>Moderation history</h3>
          </div>
          <select value={historyAction} onChange={(event) => setHistoryAction(event.target.value as "all" | Action)} style={{ ...inputStyle, width: 130 }}>
            <option value="all">Все действия</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {cases.length === 0 ? (
          <div style={{ padding: 11, color: "#687386", fontSize: 11 }}>Кейсов пока нет.</div>
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            {cases.map((item) => (
              <div key={item.id} style={{ padding: "10px 0", borderBottom: "1px solid #1d232d", display: "grid", gridTemplateColumns: "55px 80px minmax(145px,1fr) minmax(150px,1.2fr) auto", gap: 8, alignItems: "center" }}>
                <strong>#{item.id}</strong>
                <span style={{ color: "#d7ddea", fontSize: 11 }}>{ACTION_LABELS[item.action]}</span>
                <span style={{ color: "#a5afbd", fontSize: 10 }}>{item.targetUserId}</span>
                <span style={{ color: "#677285", fontSize: 10 }}>
                  {item.reason || "Без причины"} · {formatDate(item.createdAt)}
                </span>
                {item.resolvedAt ? (
                  <span style={{ color: "#78b98f", fontSize: 10 }}>Closed</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void resolveCase(item)} style={button("secondary")}>Закрыть</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
}

function formatModerationError(error: unknown): string {
  const code = error instanceof Error ? error.message : "moderation_failed";
  const messages: Record<string, string> = {
    moderation_disabled: "Модуль Moderation выключен.",
    guild_not_found: "Сервер не найден.",
    user_not_found: "Пользователь не найден.",
    member_not_found: "Участник не найден.",
    member_not_kickable: "Этого участника нельзя kick из-за Discord hierarchy.",
    member_not_moderatable: "Этого участника нельзя модерировать из-за Discord hierarchy.",
    invalid_target_user: "Некорректный Discord ID.",
    invalid_duration: "Некорректная длительность.",
    moderation_case_not_found_or_already_resolved: "Case уже закрыт или не найден."
  };
  return messages[code] ?? code;
}

const channelStyle = {
  padding: 15,
  border: "1px solid #222a35",
  borderRadius: 14,
  background: "#0d1219"
} as const;

const panel = { padding: 15, border: "1px solid #222a35", borderRadius: 14, background: "#0d1219" } as const;
const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "#0b1016",
  border: "1px solid #29313e",
  borderRadius: 9,
  padding: "9px 10px",
  color: "#f1f5f9"
};

const button = (kind: "primary" | "secondary") => ({
  border: "1px solid " + (kind === "primary" ? "#405d87" : "#303846"),
  background: kind === "primary" ? "#253c5e" : "#171c25",
  color: "#f5f7fa",
  borderRadius: 9,
  padding: "9px 12px",
  cursor: "pointer"
} as const);
