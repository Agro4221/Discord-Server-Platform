import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,
    "content-type": "application/json"
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ guildId: string; moduleKey: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { guildId, moduleKey } = await context.params;
  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/settings/${encodeURIComponent(moduleKey)}`),
    { cache: "no-store", headers: authHeaders() }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ guildId: string; moduleKey: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const { guildId, moduleKey } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const values = (body as Record<string, unknown>).values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return NextResponse.json({ error: "values_must_be_object" }, { status: 400 });
  }

  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/settings/${encodeURIComponent(moduleKey)}`),
    {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ values })
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
