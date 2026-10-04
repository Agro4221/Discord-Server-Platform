import { NextResponse } from "next/server";
import { assertSameOrigin, currentSession } from "../../../../lib/auth";

function apiUrl(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ identityId: string }> }
) {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const { identityId } = await context.params;
  const response = await fetch(
    apiUrl("/api/fleet/" + encodeURIComponent(identityId)),
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`,
        "content-type": "application/json"
      },
      body: await request.text()
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
