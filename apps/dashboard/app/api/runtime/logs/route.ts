import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "200";
  const response = await fetch(
    new URL("/api/runtime/logs?limit=" + encodeURIComponent(limit), process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"),
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}` }
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
