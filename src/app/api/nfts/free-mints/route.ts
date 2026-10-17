import { NextResponse } from "next/server";
import { ChainSchema } from "@/lib/domain";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
import { isAllowedFilterValue, parseMintDateRange } from "@/lib/server/mint-date-range";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const statuses = ["upcoming", "live", "ended", "unverified"] as const;
const eligibilities = ["public", "allowlist", "whitelist", "fcfs", "raffle", "conditional", "giveaway", "unknown"] as const;
const verifications = ["verified", "unverified", "pending", "not-applicable"] as const;
const types = ["free", "conditional-free", "low-cost"] as const;
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const parsed = clientSettingsFromRequest(request); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const chainRaw = params.get("chain"); const chain = chainRaw ? ChainSchema.safeParse(chainRaw) : null;
  if (chain && !chain.success) return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });
  const dateRange = parseMintDateRange(params.get("from"), params.get("to"));
  if (!dateRange.valid) return NextResponse.json({ error: dateRange.error }, { status: 400 });
  const status = params.get("status");
  const eligibility = params.get("eligibility");
  const verification = params.get("verification");
  const type = params.get("type");
  if (!isAllowedFilterValue(status, statuses)) return NextResponse.json({ error: "Unsupported mint status." }, { status: 400 });
  if (!isAllowedFilterValue(eligibility, eligibilities)) return NextResponse.json({ error: "Unsupported eligibility filter." }, { status: 400 });
  if (!isAllowedFilterValue(verification, verifications)) return NextResponse.json({ error: "Unsupported verification filter." }, { status: 400 });
  if (!isAllowedFilterValue(type, types)) return NextResponse.json({ error: "Unsupported mint type." }, { status: 400 });

  const data = await getDashboardPayload(parsed.settings);
  const items = data.nfts.filter((item) =>
    ["free", "conditional-free", "low-cost"].includes(item.kind)
    && (!chain || !chain.success || item.chain === chain.data)
    && (!status || item.status === status)
    && (!eligibility || item.eligibilityType === eligibility)
    && (!verification || item.securityStatus === verification)
    && (dateRange.fromTimestamp === null || Boolean(item.mintAt && Date.parse(item.mintAt) >= dateRange.fromTimestamp))
    && (dateRange.toTimestamp === null || Boolean(item.mintAt && Date.parse(item.mintAt) <= dateRange.toTimestamp))
    && (!type || item.kind === type),
  );
  items.sort((a, b) => (a.mintAt ? Date.parse(a.mintAt) : Infinity) - (b.mintAt ? Date.parse(b.mintAt) : Infinity));
  return NextResponse.json({ mode: data.mode, total: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
