import { NextResponse } from "next/server";
import { z } from "zod";
import { SCAN_HISTORY_CONFIRMATION } from "@/lib/scan-history";
import { jsonError, readBoundedJson } from "@/lib/server/api-helpers";
import { authorizeScanHistoryDelete } from "@/lib/server/scan-history-auth";
import { clearScanHistory, getStorageStatus } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({ confirmation: z.literal(SCAN_HISTORY_CONFIRMATION) }).strict();

export async function DELETE(request: Request) {
  const denied = authorizeScanHistoryDelete(request);
  if (denied) return denied;

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  let raw: unknown;
  try {
    raw = await readBoundedJson(request, 512);
  } catch (error) {
    return jsonError(error instanceof RangeError ? "Payload too large." : "Request body must be valid JSON.", error instanceof RangeError ? 413 : 400);
  }
  if (!RequestSchema.safeParse(raw).success) return jsonError("Explicit scan-history confirmation is required.", 422);

  const storage = getStorageStatus();
  if (!storage.configured) return jsonError(storage.detail, 503);

  try {
    const result = await clearScanHistory();
    return NextResponse.json({ cleared: true, provider: storage.provider, ...result }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return jsonError("Scan history could not be cleared. Check the active storage configuration and required database migration.", 503);
  }
}
