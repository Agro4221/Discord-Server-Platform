import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ guildId: string; caseId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId, caseId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const response = await fetch(
    new URL(
      "/api/guilds/" + encodeURIComponent(guildId) + "/moderation/cases/" + encodeURIComponent(caseId),
      process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
    ),
    {
      method: "PATCH",
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
