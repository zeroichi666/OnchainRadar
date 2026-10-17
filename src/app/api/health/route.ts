import { NextResponse } from "next/server";
import { publicReadLimit } from "@/lib/server/api-helpers";
import { getSupabaseServerClient, readLastSuccessfulSync } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const mode = process.env.DATA_MODE === "live" ? "live" : "demo";
  const services: { name: string; status: string; detail: string; lastSuccessAt?: string | null }[] = [];
  const supabase = getSupabaseServerClient();
  services.push({ name: "Supabase", status: supabase ? "configured" : "not-configured", detail: supabase ? "Server client is configured; database health is checked on read/write." : "Privileged database credentials are missing." });
  let syncAt: string | null = null;
  if (supabase) {
    try { syncAt = await readLastSuccessfulSync("agent-reach"); } catch { /* Report unavailable without exposing database details. */ }
  }
  const fresh = syncAt ? Date.now() - Date.parse(syncAt) <= 6 * 60 * 60 * 1000 : false;
  services.push({ name: "Agent-Reach / X", status: fresh ? "recent-sync" : syncAt ? "stale" : "not-synced", detail: fresh ? "A recent completed sync is recorded; worker connectivity is not continuously monitored." : "No recent successful worker sync is recorded.", lastSuccessAt: syncAt });
  services.push({ name: "DEX Screener", status: "adapter-ready", detail: "Public API adapter is configured in code; live connectivity is observed when candidates are enriched." });
  services.push({ name: "GoPlus EVM", status: "adapter-ready", detail: "Server-side adapter is configured; this endpoint does not claim a live provider ping." });
  services.push({ name: "Solana RPC", status: process.env.SOLANA_RPC_URL ? "configured" : "public-endpoint-default", detail: process.env.SOLANA_RPC_URL ? "A server-side RPC URL is configured." : "Public mainnet endpoint is used; rate limits may apply." });
  services.push({ name: "Worker ingestion", status: process.env.INGESTION_SECRET && process.env.SUPABASE_URL ? "configured" : "not-configured", detail: process.env.INGESTION_SECRET && process.env.SUPABASE_URL ? "Bearer-authenticated ingestion is configured." : "Set worker secret and Supabase server credentials to accept live batches." });
  return NextResponse.json({ mode, generatedAt: new Date().toISOString(), services, warnings: mode === "demo" ? ["Dashboard is currently serving explicitly labeled demo placeholders."] : [] }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
