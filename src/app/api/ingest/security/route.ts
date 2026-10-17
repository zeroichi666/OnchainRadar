import { NextResponse } from "next/server";
import { z } from "zod";
import { ChainSchema, TokenCandidateSchema } from "@/lib/domain";
import { isValidTokenAddress } from "@/lib/security";
import { fetchGoPlusSecurity } from "@/lib/server/goplus";
import { fetchSolanaSecurity } from "@/lib/server/solana-security";
import { authorizeWorkerRequest } from "@/lib/server/ingestion-auth";
import { readBoundedJson } from "@/lib/server/api-helpers";
import { getSupabaseServerClient, readCandidatesByChainAddresses, upsertSecurityReport } from "@/lib/server/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RequestSchema = z.object({ chain: ChainSchema, address: z.string().min(1).max(128) }).strict();
export async function POST(request: Request) {
  const denied = authorizeWorkerRequest(request, "ingest:security", 10); if (denied) return denied;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  let raw: unknown; try { raw = await readBoundedJson(request, 16_000); } catch (error) { return NextResponse.json({ error: error instanceof RangeError ? "Payload too large." : "Request body must be valid JSON." }, { status: error instanceof RangeError ? 413 : 400 }); }
  const parsed = RequestSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Request must contain a supported chain and address." }, { status: 422 });
  if (!isValidTokenAddress(parsed.data.chain, parsed.data.address)) return NextResponse.json({ error: "Address is invalid for the selected chain." }, { status: 422 });
  const supabase = getSupabaseServerClient(); if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const rows = await readCandidatesByChainAddresses(parsed.data.chain, [parsed.data.address]);
    const storedCandidate = rows.map((row) => TokenCandidateSchema.safeParse(row.payload)).find((item) => item.success && item.data.chain === parsed.data.chain && item.data.address?.toLowerCase() === parsed.data.address.toLowerCase());
    if (!storedCandidate?.success) return NextResponse.json({ error: "Security refresh is limited to candidates already in storage." }, { status: 404 });
    const report = parsed.data.chain === "solana" ? await fetchSolanaSecurity(parsed.data.address) : await fetchGoPlusSecurity(parsed.data.chain, parsed.data.address);
    await upsertSecurityReport(report);
    const { error: syncError } = await supabase.from("radar_sync_state").upsert({ source: `security:${parsed.data.chain}`, last_successful_at: new Date().toISOString(), details: { address: parsed.data.address.toLowerCase(), verdict: report.verdict } }, { onConflict: "source" });
    if (syncError) throw new Error("Security sync state write failed");
    return NextResponse.json({ accepted: true, report }, { status: report.verdict === "UNKNOWN" ? 202 : 200, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Security assessment failed. The address remains outside the main feed." }, { status: 503 }); }
}
