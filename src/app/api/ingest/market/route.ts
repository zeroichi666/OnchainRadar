import { NextResponse } from "next/server";
import { z } from "zod";
import { ChainSchema, TokenCandidateSchema } from "@/lib/domain";
import { isValidTokenAddress } from "@/lib/security";
import { enrichCandidateBatch } from "@/lib/server/dexscreener";
import { authorizeWorkerRequest } from "@/lib/server/ingestion-auth";
import { readBoundedJson } from "@/lib/server/api-helpers";
import { isStorageConfigured, readCandidatesByChainAddresses, upsertCandidate, upsertSyncState } from "@/lib/server/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RequestSchema = z.object({ chain: ChainSchema, addresses: z.array(z.string().min(1).max(128)).min(1).max(30) }).strict();
export async function POST(request: Request) {
  const denied = authorizeWorkerRequest(request, "ingest:market", 10); if (denied) return denied;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  let raw: unknown; try { raw = await readBoundedJson(request, 32_000); } catch (error) { return NextResponse.json({ error: error instanceof RangeError ? "Payload too large." : "Request body must be valid JSON." }, { status: error instanceof RangeError ? 413 : 400 }); }
  const parsed = RequestSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Request must contain a supported chain and 1–30 addresses." }, { status: 422 });
  if (parsed.data.addresses.some((address) => !isValidTokenAddress(parsed.data.chain, address))) return NextResponse.json({ error: "One or more addresses are invalid for the selected chain." }, { status: 422 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "Persistent storage is not configured." }, { status: 503 });
  try {
    const rows = await readCandidatesByChainAddresses(parsed.data.chain, parsed.data.addresses);
    const requested = new Set(parsed.data.addresses.map((address) => address.toLowerCase()));
    const candidates = rows.map((row) => TokenCandidateSchema.safeParse(row.payload)).filter((item) => item.success).map((item) => item.data).filter((item) => item.chain === parsed.data.chain && Boolean(item.address && requested.has(item.address.toLowerCase())));
    if (!candidates.length) return NextResponse.json({ updated: 0, warnings: ["No matching stored candidates; arbitrary addresses are not inserted by market refresh."] }, { status: 200 });
    const result = await enrichCandidateBatch(candidates);
    await Promise.all(result.candidates.map((candidate) => upsertCandidate({ id: candidate.id, chain: candidate.chain, token_address: candidate.address ?? null, payload: candidate })));
    await upsertSyncState("dexscreener", new Date().toISOString(), { updated: result.candidates.length });
    return NextResponse.json({ updated: result.candidates.length, warnings: result.warnings }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Market refresh failed. Retry later." }, { status: 503 }); }
}
