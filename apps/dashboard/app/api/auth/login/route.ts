import { NextResponse } from "next/server";
import { assertSameOrigin, issueSession, sessionCookie, validAdminPassword } from "../../../../lib/auth";

const attempts = new Map<string, { start: number; count: number }>();

const GLOBAL_KEY = "__global__";
const MAX_KEYS = 10_000;

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

function cleanup(): void {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [key, value] of attempts) {
    if (value.start < cutoff) attempts.delete(key);
  }
  if (attempts.size <= MAX_KEYS) return;

  const oldest = [...attempts.entries()]
    .sort((a, b) => a[1].start - b[1].start)
    .slice(0, attempts.size - MAX_KEYS);
  for (const [key] of oldest) attempts.delete(key);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  cleanup();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || "local";
  if (!allowed(GLOBAL_KEY, 100) || !allowed(key, 10)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8 * 1024) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const password = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).password
    : undefined;

  if (typeof password === "string" && password.length > 1024) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

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
