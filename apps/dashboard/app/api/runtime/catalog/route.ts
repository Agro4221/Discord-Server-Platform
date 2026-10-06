import { NextResponse } from "next/server";

export async function GET() {
  const response = await fetch(
    new URL("/api/runtime/catalog", process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"),
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
