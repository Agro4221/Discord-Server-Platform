import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/auth";

export async function GET() {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const response = await fetch(
    new URL("/api/module-schemas", process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002"),
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
