"use client";

import { useMemo } from "react";

type BotResource = {
  id: string;
  tag: string;
  highestRole: { id: string; name: string; position: number };
  permissions: Record<string, boolean>;
};

export function DiscordDiagnosticsPanel({ bot }: { bot: BotResource | null }) {
  const entries = useMemo(() => Object.entries(bot?.permissions ?? {}), [bot]);
  const missing = entries.filter(([, granted]) => !granted).map(([name]) => name);

  if (!bot) {
    return <div style={muted}>Bot member не найден в cache Discord.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 11 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(160px,.7fr)", gap: 12 }}>
        <div>
          <div style={label}>BOT IDENTITY</div>
          <div style={{ color: "#d7ddea", fontSize: 12, marginTop: 5 }}>{bot.tag}</div>
          <div style={{ color: "#626e80", fontSize: 9, marginTop: 3 }}>{bot.id}</div>
        </div>
        <div>
          <div style={label}>HIGHEST ROLE</div>
          <div style={{ color: "#d7ddea", fontSize: 12, marginTop: 5 }}>@{bot.highestRole.name}</div>
          <div style={{ color: "#626e80", fontSize: 9, marginTop: 3 }}>position {bot.highestRole.position}</div>
        </div>
      </div>

      <div>
        <div style={label}>KEY PERMISSIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 8 }}>
          {entries.map(([name, granted]) => (
            <div key={name} style={{
              padding: "7px 8px",
              border: "1px solid " + (granted ? "#22332a" : "#40252a"),
              background: granted ? "#101913" : "#181013",
              borderRadius: 8,
              color: granted ? "#79ba91" : "#d17982",
              fontSize: 9
            }}>
              {granted ? "✓ " : "✕ "}{name}
            </div>
          ))}
        </div>
      </div>

      <div style={{ color: "#687386", fontSize: 9, lineHeight: 1.5 }}>
        {missing.length
          ? "Недостающие глобальные права: " + missing.join(", ") + ". Отдельные channel overrides могут дополнительно ограничивать доступ."
          : "Все проверяемые глобальные права присутствуют. Channel overrides и role hierarchy всё равно проверяются на уровне конкретной операции."}
      </div>
    </div>
  );
}

const label = { color: "#687486", fontSize: 8, letterSpacing: 1.1 } as const;
const muted = { color: "#687386", fontSize: 10 } as const;
