import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}
const headers = {
  Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""),
  "content-type": "application/json"
};

export async function POST(request: Request) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const response = await fetch(upstream("/api/tiktok/oauth/exchange"), {
    method: "POST",
    headers,
    body: await request.text()
  });
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json; charset=utf-8" } });
}
