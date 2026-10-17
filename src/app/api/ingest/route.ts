import { NextResponse } from "next/server";
import { IngestionEnvelopeSchema } from "@/lib/server/ingest-schema";
import { authorizeWorkerRequest } from "@/lib/server/ingestion-auth";
import { readBoundedJson } from "@/lib/server/api-helpers";
import { persistIngestion } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request) {
  const denied = authorizeWorkerRequest(request, "ingest:social");
  if (denied) return denied;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return error("Content-Type must be application/json.", 415);
  let raw: unknown;
  try { raw = await readBoundedJson(request); }
  catch (cause) { return cause instanceof RangeError ? error("Payload exceeds the 1 MB limit.", 413) : error("Request body must be valid JSON.", 400); }
  const parsed = IngestionEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return error("Payload does not match the normalized ingestion schema.", 422);
  try {
    const result = await persistIngestion(parsed.data);
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return error("The batch was validated but could not be persisted. Retry with the same eventId.", 503);
  }
}
