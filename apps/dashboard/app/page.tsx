async function getHealth() {
  const base = process.env.BOT_HEALTH_URL ?? "http://127.0.0.1:3001/health";
  try {
    const response = await fetch(base, { cache: "no-store" });
    return await response.json() as {
      status: string;
      discord: string;
      database: string;
      modules: Record<string, string>;
      startedAt: string;
    };
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main style={{
      minHeight: "100vh",
      background: "#0b0d12",
      color: "#f4f5f7",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      padding: "40px"
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 32 }}>
          <div>
            <div style={{ opacity: 0.6, fontSize: 13, letterSpacing: 1.2 }}>DISCORD SERVER PLATFORM</div>
            <h1 style={{ fontSize: 42, margin: "8px 0 0" }}>Control Center</h1>
          </div>
          <div style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: health?.status === "ready" ? "#13351f" : "#352113"
          }}>
            {health?.status === "ready" ? "● Online" : "● Degraded / offline"}
          </div>
        </div>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
          {[
            ["Discord", health?.discord ?? "unknown"],
            ["Database", health?.database ?? "unknown"],
            ["Dashboard API", health ? "reachable" : "unreachable"]
          ].map(([name, value]) => (
            <div key={name} style={{ padding: 20, border: "1px solid #242834", borderRadius: 16, background: "#11141b" }}>
              <div style={{ opacity: 0.6, fontSize: 13 }}>{name}</div>
              <div style={{ fontSize: 24, marginTop: 8, textTransform: "capitalize" }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ padding: 20, border: "1px solid #242834", borderRadius: 16, background: "#11141b" }}>
          <h2 style={{ marginTop: 0 }}>Modules</h2>
          {health ? Object.entries(health.modules).map(([name, status]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid #1f232d" }}>
              <span>{name}</span>
              <span style={{ opacity: 0.8 }}>{status}</span>
            </div>
          )) : (
            <div style={{ opacity: 0.6 }}>Bot health endpoint is unavailable.</div>
          )}
        </section>
      </div>
    </main>
  );
}
