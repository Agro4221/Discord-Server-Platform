import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../../lib/auth";

export async function DELETE(request: Request, context: { params: Promise<{ guildId: string; ruleId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId, ruleId } = await context.params;
  const response = await fetch(
    new URL(
      `/api/guilds/${encodeURIComponent(guildId)}/automod/rules/${encodeURIComponent(ruleId)}`,
      process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"
    ),
    { method: "DELETE", headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` } }
  );
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
}
