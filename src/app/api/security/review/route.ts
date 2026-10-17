import { NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const data = await getDashboardPayload();
  return NextResponse.json({ mode: data.mode, pending: data.securityQueue, recentExclusions: data.recentExclusions, reports: data.securityReports, providerReports: data.providerReports }, { headers: { "Cache-Control": "no-store" } });
}
