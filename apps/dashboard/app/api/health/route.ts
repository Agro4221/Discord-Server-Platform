import { NextResponse } from "next/server";

export async function GET() {
  const response = await fetch(process.env.BOT_HEALTH_URL ?? "http://127.0.0.1:3001/health", {
    cache: "no-store"
  });

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
