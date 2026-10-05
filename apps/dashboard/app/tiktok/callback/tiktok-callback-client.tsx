"use client";

import { useEffect, useState } from "react";

export default function TikTokCallbackClient({ code, state }: { code: string; state: string }) {
  const [status, setStatus] = useState("Подключаем TikTok…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!code || !state) {
        setError("TikTok callback не содержит code/state.");
        return;
      }

      try {
        const response = await fetch("/api/tiktok/oauth/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, state })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "tiktok_oauth_exchange_failed");
        if (!active) return;
        setStatus("TikTok успешно подключён.");
      } catch (caught) {
        if (!active) return;
        setStatus("");
        setError(caught instanceof Error ? caught.message : "Не удалось подключить TikTok.");
      }
    })();

    return () => { active = false; };
  }, [code, state]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#090c11", color: "#f4f6fa" }}>
      <div style={{ width: "min(560px,100%)", padding: 24, border: "1px solid #29313d", borderRadius: 14, background: "#0e131a" }}>
        <div style={{ fontSize: 11, opacity: 0.45, letterSpacing: 1.2 }}>DISCORD SERVER PLATFORM</div>
        {status && <h1 style={{ marginTop: 10, fontSize: 22 }}>{status}</h1>}
        {error && (
          <>
            <h1 style={{ marginTop: 10, fontSize: 22 }}>Не удалось подключить TikTok</h1>
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#32191b", border: "1px solid #63292d" }}>{error}</div>
          </>
        )}
        <a href="/" style={{ display: "inline-block", marginTop: 18, color: "#9eb9ff" }}>Вернуться в Dashboard</a>
      </div>
    </main>
  );
}
