import { NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const data = await getDashboardPayload();
  const confirmed = data.tokens.filter((token) => token.ctoStatus === "verified" || token.ctoStatus === "probable");
  return NextResponse.json({ mode: data.mode, confirmed, review: data.ctoClaims }, { headers: { "Cache-Control": "no-store" } });
}
