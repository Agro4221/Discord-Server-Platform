import { NextResponse } from "next/server";
import { currentSession } from "../../../../../lib/auth";

function upstream(path: string): string {
  return new URL(path, process.env.MANAGEMENT_API_URL ?? "http://127.0.0.1:3002").toString();
}

async function forward(request: Request, context: { params: Promise<{ guildId: string }> }, method: "GET" | "POST" | "DELETE") {
  if (!await currentSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { guildId } = await context.params;
  const input = method === "GET" || method === "DELETE" ? undefined : await request.text();
  const response = await fetch(upstream("/api/guilds/" + encodeURIComponent(guildId) + "/role-automation"), {
    method,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + (process.env.MANAGEMENT_API_KEY ?? ""),
      ...(input ? { "content-type": "application/json" } : {})
    },
    body: input
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  return forward(request, context, "GET");
}

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  return forward(request, context, "POST");
}
