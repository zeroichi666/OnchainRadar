import { NextResponse } from "next/server";
import { ChainSchema } from "@/lib/domain";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const parsed = clientSettingsFromRequest(request); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const params = new URL(request.url).searchParams; const chainRaw = params.get("chain"); const chain = chainRaw ? ChainSchema.safeParse(chainRaw) : null;
  if (chain && !chain.success) return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });
  const from = params.get("from"); const to = params.get("to");
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) return NextResponse.json({ error: "Date filters must be valid date strings." }, { status: 400 });
  const data = await getDashboardPayload(parsed.settings);
  const type = params.get("type");
  const items = data.nfts.filter((item) => ["free", "conditional-free", "low-cost"].includes(item.kind) && (!chain || !chain.success || item.chain === chain.data) && (!params.get("status") || item.status === params.get("status")) && (!params.get("eligibility") || item.eligibilityType === params.get("eligibility")) && (!params.get("verification") || item.securityStatus === params.get("verification")) && (!from || Boolean(item.mintAt && Date.parse(item.mintAt) >= Date.parse(`${from}T00:00:00Z`))) && (!to || Boolean(item.mintAt && Date.parse(item.mintAt) <= Date.parse(`${to}T23:59:59Z`))) && (!type || item.kind === type));
  items.sort((a, b) => (a.mintAt ? Date.parse(a.mintAt) : Infinity) - (b.mintAt ? Date.parse(b.mintAt) : Infinity));
  return NextResponse.json({ mode: data.mode, total: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
