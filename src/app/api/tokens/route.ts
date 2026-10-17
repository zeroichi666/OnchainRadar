import { NextResponse } from "next/server";
import { ChainSchema } from "@/lib/domain";
import { scoreApprovedToken } from "@/lib/scoring";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const parsed = clientSettingsFromRequest(request); if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const chainRaw = params.get("chain"); const chain = chainRaw ? ChainSchema.safeParse(chainRaw) : null;
  if (chain && !chain.success) return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });
  const page = Math.max(1, Math.min(10_000, Number(params.get("page") ?? 1) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize") ?? 25) || 25));
  const minCap = params.get("minMarketCap") ? Number(params.get("minMarketCap")) : 0;
  if (!Number.isFinite(minCap) || minCap < 0 || minCap > 1_000_000_000_000) return NextResponse.json({ error: "Invalid market-cap threshold." }, { status: 400 });
  const response = await getDashboardPayload(parsed.settings);
  const reports = new Map(response.securityReports.map((item) => [`${item.chain}:${item.address.toLowerCase()}`, item]));
  const query = (params.get("q") ?? "").slice(0, 120).toLowerCase();
  const verdict = params.get("security");
  if (verdict && !["PASS", "WARNING"].includes(verdict)) return NextResponse.json({ error: "Security filter must be PASS or WARNING." }, { status: 400 });
  const sort = params.get("sort") ?? "score";
  const period = params.get("period") === "24h" ? "24h" : "1h";
  const items = response.tokens.filter((token) => {
    const report = token.address ? reports.get(`${token.chain}:${token.address.toLowerCase()}`) : undefined;
    return (!chain || !chain.success || token.chain === chain.data) && (!query || `${token.name} ${token.symbol} ${token.address ?? ""} ${token.narrativeCategory ?? ""}`.toLowerCase().includes(query)) && (token.metrics.marketCapUsd ?? -1) >= minCap && (!verdict || report?.verdict === verdict);
  }).map((token) => ({ token, score: scoreApprovedToken(token).total ?? null, security: token.address ? reports.get(`${token.chain}:${token.address.toLowerCase()}`) ?? null : null }));
  items.sort((a, b) => sort === "name" ? a.token.name.localeCompare(b.token.name) : sort === "marketCap" ? (b.token.metrics.marketCapUsd ?? -1) - (a.token.metrics.marketCapUsd ?? -1) : sort === "liquidity" ? (b.token.metrics.liquidityUsd ?? -1) - (a.token.metrics.liquidityUsd ?? -1) : sort === "change" ? (b.token.metrics[period === "1h" ? "change1hPct" : "change24hPct"] ?? -Infinity) - (a.token.metrics[period === "1h" ? "change1hPct" : "change24hPct"] ?? -Infinity) : (b.score ?? -1) - (a.score ?? -1));
  return NextResponse.json({ mode: response.mode, generatedAt: response.generatedAt, total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) }, { headers: { "Cache-Control": "no-store" } });
}
