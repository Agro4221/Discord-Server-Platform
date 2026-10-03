import { NextResponse } from "next/server";
import { currentSession } from "../../../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string; name: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId, name } = await context.params;
  const response = await fetch(upstream("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/presets/" + encodeURIComponent(name)), {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? "") }
  });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ guildId: string; name: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId, name } = await context.params;
  const response = await fetch(upstream("/api/guilds/" + encodeURIComponent(guildId) + "/moderation/presets/" + encodeURIComponent(name)), {
    method: "DELETE",
    cache: "no-store",
    headers: { Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? "") }
  });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json; charset=utf-8" } });
}
