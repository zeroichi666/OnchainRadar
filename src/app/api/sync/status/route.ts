import { NextResponse } from "next/server";
import { publicReadLimit } from "@/lib/server/api-helpers";
import { readLastSuccessfulSync, getSupabaseServerClient } from "@/lib/server/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const mode = process.env.DATA_MODE === "live" ? "live" : "demo";
  if (!getSupabaseServerClient()) return NextResponse.json({ mode, source: "agent-reach", lastSuccessfulAt: null, status: "not-configured", staleAfterSeconds: 21600 }, { headers: { "Cache-Control": "no-store" } });
  try {
    const lastSuccessfulAt = await readLastSuccessfulSync("agent-reach");
    const parsedAt = lastSuccessfulAt ? Date.parse(lastSuccessfulAt) : NaN;
    const ageSeconds = Number.isFinite(parsedAt) ? Math.max(0, Math.floor((Date.now() - parsedAt) / 1000)) : null;
    const status = !lastSuccessfulAt ? "not-synced" : !Number.isFinite(parsedAt) ? "invalid" : ageSeconds! > 21600 ? "stale" : "fresh";
    return NextResponse.json({ mode, source: "agent-reach", lastSuccessfulAt, ageSeconds, staleAfterSeconds: 21600, status }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ mode, source: "agent-reach", lastSuccessfulAt: null, status: "unavailable", staleAfterSeconds: 21600 }, { headers: { "Cache-Control": "no-store" } }); }
}
