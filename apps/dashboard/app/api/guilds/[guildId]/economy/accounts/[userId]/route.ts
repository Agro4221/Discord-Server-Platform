import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

export async function PUT(request: Request, context: { params: Promise<{ guildId: string; userId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId, userId } = await context.params;
  const response = await fetch(
    new URL("/api/guilds/" + encodeURIComponent(guildId) + "/economy/accounts/" + encodeURIComponent(userId), process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"),
    {
      method: "PUT",
      headers: { Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""), "content-type": "application/json" },
      body: await request.text()
    }
  );
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json; charset=utf-8" } });
}
