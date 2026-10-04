"use client";

import { useEffect, useState } from "react";

type ReputationEntry = { userId: string; points: number };
type LevelEntry = { userId: string; xp: number; level: number };
type GiveawayEntry = { id: number; prize: string; winners: number; endsAt: string };
type PollEntry = { id: number; question: string; optionCount: number; voterCount: number; endsAt: string | null };
type Snapshot = { reputation: ReputationEntry[]; leveling: LevelEntry[]; giveaways: GiveawayEntry[]; polls: PollEntry[] };

export function CommunityHubPanel({ guildId }: { guildId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/guilds/" + encodeURIComponent(guildId) + "/community/overview", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "community_overview_failed");
      setSnapshot(body.overview as Snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить Community Hub.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [guildId]);

  if (loading) return <div style={muted}>Загрузка Community Hub…</div>;
  if (error) return <div style={errorStyle}>{error}</div>;
  if (!snapshot) return null;

  return (
    <section style={wrapper}>
      <div style={header}>
        <div>
          <div style={eyebrow}>COMMUNITY PULSE</div>
          <strong style={{ fontSize: 14 }}>Community Hub</strong>
          <div style={muted}>Живая сводка уже существующих engagement-модулей.</div>
        </div>
        <button type="button" onClick={() => void load()} style={refresh}>Обновить</button>
      </div>

      <div style={grid}>
        <Widget title="🏆 Reputation" subtitle="Топ участников">
          {snapshot.reputation.length ? snapshot.reputation.slice(0, 5).map((entry, index) => (
            <Row key={entry.userId} label={"#" + (index + 1) + " <@" + entry.userId + ">"} value={String(entry.points)} />
          )) : <Empty text="Репутация пока не выдавалась." />}
        </Widget>

        <Widget title="📈 Leveling" subtitle="Топ по XP">
          {snapshot.leveling.length ? snapshot.leveling.slice(0, 5).map((entry, index) => (
            <Row key={entry.userId} label={"#" + (index + 1) + " <@" + entry.userId + "> · lvl " + entry.level} value={entry.xp.toLocaleString("ru-RU")} />
          )) : <Empty text="XP пока нет." />}
        </Widget>

        <Widget title="🎁 Giveaways" subtitle="Активные">
          {snapshot.giveaways.length ? snapshot.giveaways.map((entry) => (
            <Row key={entry.id} label={"#" + entry.id + " · " + entry.prize} value={entry.winners + " winner" + (entry.winners === 1 ? "" : "s")} />
          )) : <Empty text="Активных розыгрышей нет." />}
        </Widget>

        <Widget title="📊 Polls" subtitle="Открытые">
          {snapshot.polls.length ? snapshot.polls.map((entry) => (
            <Row key={entry.id} label={"#" + entry.id + " · " + entry.question} value={entry.voterCount + " voters"} />
          )) : <Empty text="Открытых опросов нет." />}
        </Widget>
      </div>
    </section>
  );
}

function Widget({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={widget}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 11 }}>{title}</strong>
        <div style={muted}>{subtitle}</div>
      </div>
      <div style={{ display: "grid", gap: 5 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div style={row}><span style={labelStyle}>{label}</span><strong style={valueStyle}>{value}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div style={{ ...muted, padding: "8px 0" }}>{text}</div>;
}

const wrapper = { padding: 17, border: "1px solid #252c38", borderRadius: 18, background: "linear-gradient(180deg,#131720 0%,#0e1117 100%)" } as const;
const header = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 9 } as const;
const widget = { padding: 11, border: "1px solid #202732", borderRadius: 12, background: "#0e131a", minHeight: 145 } as const;
const row = { display: "flex", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 8, background: "#0c1118", border: "1px solid #1b232e" } as const;
const labelStyle = { flex: 1, minWidth: 0, color: "#b8c0cc", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const valueStyle = { color: "#e8edf4", fontSize: 9 } as const;
const muted = { color: "#697486", fontSize: 9, lineHeight: 1.45 } as const;
const eyebrow = { color: "#536074", fontSize: 9, letterSpacing: 1.2 } as const;
const refresh = { border: "1px solid #303846", background: "#171c24", color: "#d7dde6", borderRadius: 8, padding: "7px 9px", cursor: "pointer" } as const;
const errorStyle = { padding: 9, borderRadius: 9, border: "1px solid #63292d", background: "#32191b", color: "#f1c3c5", fontSize: 10 } as const;