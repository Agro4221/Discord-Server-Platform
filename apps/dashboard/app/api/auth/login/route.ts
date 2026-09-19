import { NextResponse } from "next/server";
import { issueSession, sessionCookie, validAdminPassword } from "../../../../lib/auth";

const attempts = new Map<string, { start: number; count: number }>();

function allowed(key: string): boolean {
  const now = Date.now();
  const window = attempts.get(key);
  if (!window || now - window.start >= 15 * 60_000) {
    attempts.set(key, { start: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= 10;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(ip)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const password = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).password
    : undefined;

  if (typeof password !== "string" || !validAdminPassword(password)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: sessionCookie,
    value: issueSession(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60
  });
  return response;
}
