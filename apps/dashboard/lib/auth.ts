export function dashboardAuthRequired(): boolean {
  return false;
}

export async function currentSession(): Promise<boolean> {
  return true;
}

export async function requireSession(): Promise<void> {
  return;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  const expected = host ? `http${process.env.NODE_ENV === "production" ? "s" : ""}://${host}` : null;
  if (expected && origin !== expected) throw new Error("bad_origin");
}
