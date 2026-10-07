export function dashboardAuthRequired(): boolean {
  return false;
}

/**
 * Local-first Control Center intentionally has no end-user authentication.
 * The Dashboard itself is bound to loopback by default and its server-side
 * requests to the Management API use the internal bearer key.
 *
 * These compatibility helpers keep existing API routes on one access contract.
 */
export async function currentSession(): Promise<boolean> {
  return true;
}

export async function requireSession(): Promise<void> {
  // Intentionally empty: local Control Center has no user login.
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("host");
  const expected = host
    ? (forwardedProto ? `${forwardedProto}://${host}` : `${requestUrl.protocol}//${host}`)
    : requestUrl.origin;

  if (origin !== expected) throw new Error("bad_origin");
}
