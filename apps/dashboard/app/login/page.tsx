"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        setError(response.status === 429 ? "Слишком много попыток. Попробуй позже." : "Неверный пароль.");
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Не удалось выполнить вход.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#0b0d12",
      color: "#f4f5f7",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      padding: 24
    }}>
      <form onSubmit={submit} style={{
        width: "min(420px, 100%)",
        background: "#11141b",
        border: "1px solid #242934",
        borderRadius: 20,
        padding: 28,
        boxSizing: "border-box"
      }}>
        <div style={{ opacity: 0.52, fontSize: 12, letterSpacing: 1.8 }}>DISCORD SERVER PLATFORM</div>
        <h1 style={{ margin: "8px 0", fontSize: 34 }}>Control Center</h1>
        <p style={{ opacity: 0.62, lineHeight: 1.5 }}>Локальная админка твоего self-hosted экземпляра.</p>

        <label style={{ display: "block", marginTop: 24 }}>
          <span style={{ display: "block", fontSize: 13, opacity: 0.62, marginBottom: 8 }}>Пароль</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "12px 13px", borderRadius: 10, border: "1px solid #303643", background: "#0d1016", color: "#fff" }}
          />
        </label>

        {error && <div style={{ marginTop: 14, color: "#ffb3b3" }}>{error}</div>}

        <button
          type="submit"
          disabled={busy || !password}
          style={{ width: "100%", marginTop: 18, border: 0, borderRadius: 10, padding: "12px 14px", background: "#5865f2", color: "#fff", cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Вход..." : "Войти"}
        </button>
      </form>
    </main>
  );
}
