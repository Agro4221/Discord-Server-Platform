import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

function authHeaders(contentType?: boolean): HeadersInit {
  return {
    Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""),
    ...(contentType ? { "content-type": "application/json" } : {})
  };
}

export async function PUT(request: Request, context: { params: Promise<{ guildId: string; itemId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId, itemId } = await context.params;
  const response = await fetch(
    upstream(
      "/api/guilds/" + encodeURIComponent(guildId) +
      "/economy/items/" + encodeURIComponent(itemId)
    ),
    {
      method: "PUT",
      headers: authHeaders(true),
      body: await request.text()
    }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ guildId: string; itemId: string }> }) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const { guildId, itemId } = await context.params;
  const response = await fetch(
    upstream(
      "/api/guilds/" + encodeURIComponent(guildId) +
      "/economy/items/" + encodeURIComponent(itemId)
    ),
    {
      method: "DELETE",
      headers: authHeaders()
    }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
