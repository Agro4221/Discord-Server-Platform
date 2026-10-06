import { NextResponse } from "next/server";
import { assertSameOrigin } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const response = await fetch(
    new URL("/api/runtime/shutdown", process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"),
    {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
