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

export async function GET(
  _request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/music-bots`),
    { cache: "no-store", headers: headers() }
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (typeof input.botIdentityId !== "string" || typeof input.voiceChannelId !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/music-bots/assign`),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        botIdentityId: input.botIdentityId,
        voiceChannelId: input.voiceChannelId
      })
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ guildId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }

  const { guildId } = await context.params;
  const identity = new URL(request.url).searchParams.get("botIdentityId");
  if (!identity || identity.length > 100) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const response = await fetch(
    upstream(`/api/guilds/${encodeURIComponent(guildId)}/music-bots/${encodeURIComponent(identity)}`),
    {
      method: "DELETE",
      headers: headers()
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
