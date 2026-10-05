import { NextResponse } from "next/server";
import { currentSession } from "../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,
    "content-type": "application/json"
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { guildId } = await context.params;
  const incoming = new URL(request.url);
  const query = new URLSearchParams();

  for (const key of ["limit", "source", "action", "actorUserId", "before"]) {
    const value = incoming.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const suffix = query.toString() ? "?" + query.toString() : "";
  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/audit${suffix}`),
    { cache: "no-store", headers: headers() }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
