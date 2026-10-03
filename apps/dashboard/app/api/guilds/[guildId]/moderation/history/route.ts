import { NextResponse } from "next/server";
import { currentSession } from "../../../../../../lib/auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const source = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["userId", "action", "limit"]) {
    const value = source.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const response = await fetch(
    new URL(
      "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/history" + (query.size ? "?" + query.toString() : ""),
      process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
    ),
    {
      method: "GET",
      headers: { Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? "") },
      cache: "no-store"
    }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
