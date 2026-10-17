import { NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = publicReadLimit(request);
  if (limited) return limited;
  const parsed = clientSettingsFromRequest(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const payload = await getDashboardPayload(parsed.settings);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Dashboard data could not be loaded. Check the server data configuration." }, { status: 500, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
