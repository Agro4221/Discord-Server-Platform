import { NextResponse } from "next/server";
import { assertSameOrigin, sessionCookie } from "../../../../lib/auth";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "bad_origin" }, { status: 403 }); }
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: sessionCookie,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  return response;
}
