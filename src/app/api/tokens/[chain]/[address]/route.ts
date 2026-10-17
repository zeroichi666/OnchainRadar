import { NextResponse } from "next/server";
import { ChainSchema } from "@/lib/domain";
import { isValidTokenAddress } from "@/lib/security";
import { getDashboardPayload } from "@/lib/server/dashboard";
import { clientSettingsFromRequest, publicReadLimit } from "@/lib/server/api-helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ chain: string; address: string }> }) {
  const limited = publicReadLimit(request); if (limited) return limited;
  const parsedSettings = clientSettingsFromRequest(request);
  if (parsedSettings.error) return NextResponse.json({ error: parsedSettings.error }, { status: 400 });
  const { chain: rawChain, address } = await context.params;
  const chain = ChainSchema.safeParse(rawChain);
  if (!chain.success || !isValidTokenAddress(chain.data, address)) return NextResponse.json({ error: "Invalid chain or token address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const data = await getDashboardPayload(parsedSettings.settings);
  const token = data.tokens.find((item) => item.chain === chain.data && item.address?.toLowerCase() === address.toLowerCase());
  if (!token) return NextResponse.json({ error: "Token is not currently in the security-cleared feed." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const security = data.securityReports.find((item) => item.chain === token.chain && item.address.toLowerCase() === address.toLowerCase()) ?? null;
  const providerResults = data.providerReports.filter((item) => item.chain === token.chain && item.address.toLowerCase() === address.toLowerCase());
  const narrativeHistory = data.narratives.filter((item) => item.category === token.narrativeCategory || item.sourcePosts.some((post) => post.text.toLowerCase().includes(token.symbol.toLowerCase())));
  const explorer = token.chain === "solana" ? `https://explorer.solana.com/address/${encodeURIComponent(address)}` : ({ ethereum: "https://etherscan.io/token/", base: "https://basescan.org/token/", arbitrum: "https://arbiscan.io/token/", optimism: "https://optimistic.etherscan.io/token/", polygon: "https://polygonscan.com/token/", bsc: "https://bscscan.com/token/" } as Record<string, string>)[token.chain] + encodeURIComponent(address);
  return NextResponse.json({ mode: data.mode, token, security, providerResults, narrativeHistory, explorerUrl: explorer, generatedAt: data.generatedAt }, { headers: { "Cache-Control": "no-store" } });
}
