import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../lib/auth";

const upstream = (guildId: string) =>
  new URL(
    `/api/guilds/${encodeURIComponent(guildId)}/economy/items`,
    process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
  );

export async function GET(_request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const response = await fetch(upstream(guildId), { cache: "no-store", headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` } });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId } = await context.params;
  const response = await fetch(upstream(guildId), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify(await request.json())
  });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
}
