import { NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
import { filterSocialClaimsForDay } from "@/lib/social-review";
import { isValidDateOnly, todayInTimeZone } from "@/lib/local-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = publicReadLimit(request);
  if (limited) return limited;
  const parsed = clientSettingsFromRequest(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const requestedDate = new URL(request.url).searchParams.get("socialDate");
  const socialDate = requestedDate === "today" ? todayInTimeZone() : requestedDate;
  if (socialDate !== null && !isValidDateOnly(socialDate)) return NextResponse.json({ error: "socialDate must be today or a valid YYYY-MM-DD date in Asia/Jakarta." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const payload = await getDashboardPayload(parsed.settings);
    const response = socialDate ? { ...payload, socialReviewQueue: filterSocialClaimsForDay(payload.socialReviewQueue, socialDate) } : payload;
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Social-Date": socialDate ?? "all", "X-Social-Time-Zone": "Asia/Jakarta" } });
  } catch {
    return NextResponse.json({ error: "Dashboard data could not be loaded. Check the server data configuration." }, { status: 500, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
