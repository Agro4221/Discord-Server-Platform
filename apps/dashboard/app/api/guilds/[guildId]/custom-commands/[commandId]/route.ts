import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,
    "content-type": "application/json"
  };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ guildId: string; commandId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId, commandId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/custom-commands/${encodeURIComponent(commandId)}`),
    { method: "PUT", headers: headers(), body: JSON.stringify(body) }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ guildId: string; commandId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId, commandId } = await context.params;
  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/custom-commands/${encodeURIComponent(commandId)}`),
    { method: "DELETE", headers: headers() }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
