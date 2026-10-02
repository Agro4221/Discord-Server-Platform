import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ guildId: string; moduleKey: string; actionId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId, moduleKey, actionId } = await context.params;
  const response = await fetch(
    new URL(
      "/api/guilds/" + encodeURIComponent(guildId) + "/actions/" + encodeURIComponent(moduleKey) + "/" + encodeURIComponent(actionId),
      process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
    ),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
    }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
