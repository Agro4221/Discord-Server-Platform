import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/auth";

function apiUrl(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

export async function GET() {
  if (!await currentSession()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await fetch(apiUrl("/api/guilds"), {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${process.env.MANAGEMENT_API_KEY ?? ""}`
    }
  });

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
