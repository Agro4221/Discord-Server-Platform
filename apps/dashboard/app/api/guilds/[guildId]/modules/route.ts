import { NextResponse } from "next/server";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

function authHeaders() {
  return { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  const { guildId } = await context.params;
  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/modules`),
    { cache: "no-store", headers: authHeaders() }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  const { guildId } = await context.params;
  const body = await request.json() as { moduleKey?: unknown; enabled?: unknown };

  if (typeof body.moduleKey !== "string" || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const response = await fetch(
    upstream(
      `/api/guilds/${encodeURIComponent(guildId)}/modules/${encodeURIComponent(body.moduleKey)}`
    ),
    {
      method: "PUT",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ enabled: body.enabled })
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
