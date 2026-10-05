import { NextResponse } from "next/server";
import { currentSession } from "../../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const query = new URL(request.url).search;
  const response = await fetch(upstream("/api/guilds/" + encodeURIComponent(guildId) + "/analytics/export" + query), {
    cache: "no-store",
    headers: { Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? "") }
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment"
    }
  });
}
