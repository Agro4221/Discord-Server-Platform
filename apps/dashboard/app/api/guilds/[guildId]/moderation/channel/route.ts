import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const response = await fetch(
    new URL(
      "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/channel",
      process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
    ),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""),
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
