import { NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const params = new URL(request.url).searchParams; const query = (params.get("q") ?? "").slice(0, 120).toLowerCase();
  const data = await getDashboardPayload();
  const items = data.narratives.filter((item) => !query || `${item.category} ${item.sourcePosts.map((post) => post.text).join(" ")}`.toLowerCase().includes(query)).sort((a, b) => (b.accelerationScore ?? -1) - (a.accelerationScore ?? -1));
  return NextResponse.json({ mode: data.mode, total: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
