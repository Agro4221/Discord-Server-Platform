import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "dsp_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.DASHBOARD_SESSION_SECRET;
  if (!value) throw new Error("Missing DASHBOARD_SESSION_SECRET");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueSession(): string {
  const payload = JSON.stringify({ iat: Date.now() });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const [encoded, provided] = value.split(".");
  if (!encoded || !provided) return false;

  const expected = signature(encoded);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { iat?: number };
    return typeof payload.iat === "number" &&
      Number.isSafeInteger(payload.iat) &&
      Date.now() - payload.iat >= 0 &&
      Date.now() - payload.iat < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

export async function currentSession(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookie = SESSION_COOKIE;

export function validAdminPassword(candidate: string): boolean {
  const expected = process.env.DASHBOARD_ADMIN_PASSWORD;
  if (!expected || !candidate) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requireSession(): Promise<void> {
  if (!await currentSession()) throw new Error("unauthorized");
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  const expected = host ? `http${process.env.NODE_ENV === "production" ? "s" : ""}://${host}` : null;
  if (expected && origin !== expected) throw new Error("bad_origin");
}
