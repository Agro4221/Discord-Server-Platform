"use client";

import { useMemo, useState } from "react";

type Resource = { id: string; name: string; type?: number };

export function WelcomePanel(props: {
  guildId: string;
  channels: Resource[];
  values: Record<string, unknown>;
}) {
  const configuredChannelId = typeof props.values.channelId === "string" ? props.values.channelId : "";
  const configuredGoodbyeChannelId = typeof props.values.goodbyeChannelId === "string" ? props.values.goodbyeChannelId : "";
  const welcomeTemplate = typeof props.values.message === "string" ? props.values.message : "";
  const goodbyeTemplate = typeof props.values.goodbyeMessage === "string" ? props.values.goodbyeMessage : "";

  const [kind, setKind] = useState<"welcome" | "goodbye">("welcome");
  const [channelId, setChannelId] = useState(configuredChannelId || configuredGoodbyeChannelId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedTemplate = kind === "goodbye" ? goodbyeTemplate : welcomeTemplate;
  const preview = useMemo(
    () => selectedTemplate
      .replaceAll("{mention}", "@example-user")
      .replaceAll("{user}", "example-user")
      .replaceAll("{server}", "Example Server"),
    [selectedTemplate]
  );

  async function sendTest() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(props.guildId) + "/welcome/test",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, channelId: channelId || null })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "welcome_test_failed"));
      setNotice((kind === "goodbye" ? "Goodbye" : "Welcome") + " test отправлен.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Тестовая отправка не удалась.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {(error || notice) && (
        <div style={{
          padding: 9,
          borderRadius: 9,
          border: "1px solid " + (error ? "#63292d" : "#293a31"),
          background: error ? "#32191b" : "#112018",
          color: error ? "#ffb1b1" : "#9de0b7",
          fontSize: 10
        }}>
          {error || notice}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "150px minmax(180px,1fr) auto", gap: 8, alignItems: "end" }}>
        <label style={boxStyle}>
          <span>Тест</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as "welcome" | "goodbye")} style={inputStyle}>
            <option value="welcome">Welcome</option>
            <option value="goodbye">Goodbye</option>
          </select>
        </label>

        <label style={boxStyle}>
          <span>Канал (пусто = настроенный)</span>
          <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
            <option value="">Использовать настройку</option>
            {props.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>#{channel.name}</option>
            ))}
          </select>
        </label>

        <button type="button" disabled={busy} onClick={() => void sendTest()} style={buttonStyle}>
          {busy ? "Отправляем…" : "Отправить тест"}
        </button>
      </div>

      <section style={box}>
        <div style={eyebrow}>PREVIEW</div>
        <div style={{ marginTop: 7, padding: 11, borderRadius: 10, background: "#0b1016", border: "1px solid #252d38", color: "#dce2ea", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {preview || "Шаблон пуст."}
        </div>
        <div style={{ marginTop: 7, color: "#667284", fontSize: 9 }}>
          Превью не пингует пользователя: <code>@example-user</code> используется как тестовый placeholder.
        </div>
      </section>
    </div>
  );
}

const boxStyle = { display: "grid", gap: 5, color: "#798496", fontSize: 9 } as const;
const box = { padding: 12, border: "1px solid #222a35", borderRadius: 12, background: "#0d1219" } as const;
const eyebrow = { color: "#566274", fontSize: 8, letterSpacing: 1.2 } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, background: "#0b1016", border: "1px solid #29313e", borderRadius: 9, padding: "9px 10px", color: "#f1f5f9" };
const buttonStyle = { border: "1px solid #405d87", background: "#253c5e", color: "#fff", borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 10 } as const;
