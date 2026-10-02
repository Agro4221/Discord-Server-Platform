import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../lib/auth";

const upstream = (guildId: string, suffix = "") =>
  new URL(
    `/api/guilds/${encodeURIComponent(guildId)}/leveling${suffix}`,
    process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
  );

export async function GET(_request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const response = await fetch(upstream(guildId), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const suffix = "/exclusions";
  const response = await fetch(upstream(guildId, suffix), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
