import { NextResponse } from "next/server";
import { currentSession } from "../../../../../../lib/auth";

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "";
  const upstream = new URL(
    `/api/guilds/${encodeURIComponent(guildId)}/moderation/history?userId=${encodeURIComponent(userId)}`,
    process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
  );
  const response = await fetch(upstream, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" }
  });
}
