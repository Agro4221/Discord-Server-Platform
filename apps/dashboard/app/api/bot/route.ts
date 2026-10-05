import { NextResponse } from "next/server";
import { assertSameOrigin } from "../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

const headers = {
  Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""),
  "content-type": "application/json"
};

export async function GET() {
  const response = await fetch(upstream("/api/bot"), { cache: "no-store", headers });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function PUT(request: Request) {
  try { assertSameOrigin(request); } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }
  const body = await request.text();
  const response = await fetch(upstream("/api/bot"), {
    method: "PUT",
    cache: "no-store",
    headers,
    body
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}


export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }
  const response = await fetch(upstream("/api/bot/test"), {
    method: "POST",
    cache: "no-store",
    headers,
    body: await request.text()
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
