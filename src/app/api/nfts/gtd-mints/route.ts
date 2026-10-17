import { NextResponse } from "next/server";
import { ChainSchema } from "@/lib/domain";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
import { isAllowedFilterValue, parseMintDateRange } from "@/lib/server/mint-date-range";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const statuses = ["officially-confirmed", "third-party-reported", "unverified", "expired", "potentially-misleading"] as const;
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const parsed = clientSettingsFromRequest(request); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const chainRaw = params.get("chain"); const chain = chainRaw ? ChainSchema.safeParse(chainRaw) : null;
  if (chain && !chain.success) return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });
  const dateRange = parseMintDateRange(params.get("from"), params.get("to"));
  if (!dateRange.valid) return NextResponse.json({ error: dateRange.error }, { status: 400 });
  const status = params.get("status");
  if (!isAllowedFilterValue(status, statuses)) return NextResponse.json({ error: "Unsupported GTD status." }, { status: 400 });

  const data = await getDashboardPayload(parsed.settings);
  const items = data.gtd.filter((item) =>
    (!chain || !chain.success || item.chain === chain.data)
    && (!status || item.status === status)
    && (dateRange.fromTimestamp === null || Boolean(item.mintAt && Date.parse(item.mintAt) >= dateRange.fromTimestamp))
    && (dateRange.toTimestamp === null || Boolean(item.mintAt && Date.parse(item.mintAt) <= dateRange.toTimestamp)),
  );
  items.sort((a, b) => (a.mintAt ? Date.parse(a.mintAt) : Infinity) - (b.mintAt ? Date.parse(b.mintAt) : Infinity));
  return NextResponse.json({ mode: data.mode, total: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
