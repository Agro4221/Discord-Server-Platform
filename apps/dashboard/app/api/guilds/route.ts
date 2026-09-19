import { NextResponse } from "next/server";

function apiUrl(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

export async function GET() {
  const response = await fetch(apiUrl("/api/guilds"), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
