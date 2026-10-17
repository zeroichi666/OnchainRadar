import { z } from "zod";
import type { Chain, TokenCandidate } from "@/lib/domain";

const API = "https://api.dexscreener.com";
const CACHE_TTL_MS = 30_000;
const MAX_ADDRESSES_PER_REQUEST = 30;
const cache = new Map<string, { expiresAt: number; value: DexPair[] }>();

const DexPairSchema = z.object({
  chainId: z.string().optional(),
  dexId: z.string().optional(),
  url: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  pairAddress: z.string().optional(),
  baseToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }).optional(),
  quoteToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }).optional(),
  priceUsd: z.string().nullable().optional(),
  txns: z.record(z.string(), z.object({ buys: z.number().optional(), sells: z.number().optional() }).passthrough()).optional(),
  volume: z.record(z.string(), z.number()).optional(),
  priceChange: z.record(z.string(), z.number()).optional(),
  liquidity: z.object({ usd: z.number().nullable().optional() }).passthrough().optional(),
  fdv: z.number().nullable().optional(),
  marketCap: z.number().nullable().optional(),
  pairCreatedAt: z.number().nullable().optional(),
  info: z.object({ imageUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(), websites: z.array(z.object({ url: z.string().url().refine((value) => value.startsWith("https://")) }).passthrough()).optional(), socials: z.array(z.object({ platform: z.string(), handle: z.string() }).passthrough()).optional() }).passthrough().optional(),
}).passthrough();
export type DexPair = z.infer<typeof DexPairSchema>;

const dexChain: Record<Chain, string> = {
  solana: "solana", ethereum: "ethereum", base: "base", arbitrum: "arbitrum", optimism: "optimism", polygon: "polygon", bsc: "bsc",
};

function numericString(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectBestPair(pairs: DexPair[], address: string): DexPair | undefined {
  return pairs
    .filter((pair) => pair.baseToken?.address.toLowerCase() === address.toLowerCase() || pair.quoteToken?.address.toLowerCase() === address.toLowerCase())
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}

export function mergeDexPair(candidate: TokenCandidate, pair: DexPair): TokenCandidate {
  const isBase = pair.baseToken?.address.toLowerCase() === candidate.address?.toLowerCase();
  const token = isBase ? pair.baseToken : pair.quoteToken;
  const h24 = pair.txns?.h24;
  return {
    ...candidate,
    name: token?.name || candidate.name,
    symbol: token?.symbol || candidate.symbol,
    logoUrl: pair.info?.imageUrl || candidate.logoUrl,
    metrics: {
      ...candidate.metrics,
      priceUsd: numericString(pair.priceUsd) ?? candidate.metrics.priceUsd,
      marketCapUsd: pair.marketCap ?? candidate.metrics.marketCapUsd,
      fdvUsd: pair.fdv ?? candidate.metrics.fdvUsd,
      liquidityUsd: pair.liquidity?.usd ?? candidate.metrics.liquidityUsd,
      volume24hUsd: pair.volume?.h24 ?? candidate.metrics.volume24hUsd,
      change5mPct: pair.priceChange?.m5 ?? candidate.metrics.change5mPct,
      change1hPct: pair.priceChange?.h1 ?? candidate.metrics.change1hPct,
      change6hPct: pair.priceChange?.h6 ?? candidate.metrics.change6hPct,
      change24hPct: pair.priceChange?.h24 ?? candidate.metrics.change24hPct,
      buys24h: h24?.buys ?? candidate.metrics.buys24h,
      sells24h: h24?.sells ?? candidate.metrics.sells24h,
      poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : candidate.metrics.poolCreatedAt,
      poolAddress: pair.pairAddress || candidate.metrics.poolAddress,
      dexId: pair.dexId || candidate.metrics.dexId,
      pairUrl: pair.url || candidate.metrics.pairUrl,
    },
  };
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    } catch (error) {
      lastError = error;
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1))); continue; }
      break;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`DexScreener returned HTTP ${response.status}`);
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1))); continue; }
      break;
    }
    if (!response.ok) throw new Error(`DexScreener returned HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new Error("DexScreener returned invalid JSON"); }
  }
  throw lastError instanceof Error ? lastError : new Error("DexScreener request failed");
}

export async function fetchDexPairs(chain: Chain, addresses: string[], fetcher: typeof fetch = fetch, now = Date.now()): Promise<DexPair[]> {
  const unique = [...new Set(addresses)].slice(0, MAX_ADDRESSES_PER_REQUEST);
  if (!unique.length) return [];
  const cacheKey = `${chain}:${unique.map((item) => item.toLowerCase()).sort().join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const path = unique.map(encodeURIComponent).join(",");
  const raw = await fetchJson(`${API}/tokens/v1/${dexChain[chain]}/${path}`, fetcher);
  const parsed = z.array(DexPairSchema).safeParse(raw);
  if (!parsed.success) throw new Error("DexScreener response did not match the documented token-pairs shape");
  cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value: parsed.data });
  return parsed.data;
}

export async function enrichCandidateBatch(candidates: TokenCandidate[], fetcher: typeof fetch = fetch): Promise<{ candidates: TokenCandidate[]; warnings: string[] }> {
  const grouped = new Map<Chain, TokenCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.address) continue;
    grouped.set(candidate.chain, [...(grouped.get(candidate.chain) ?? []), candidate]);
  }
  const output = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const warnings: string[] = [];
  for (const [chain, group] of grouped) {
    for (let offset = 0; offset < group.length; offset += MAX_ADDRESSES_PER_REQUEST) {
      const batch = group.slice(offset, offset + MAX_ADDRESSES_PER_REQUEST);
      try {
        const pairs = await fetchDexPairs(chain, batch.flatMap((item) => item.address ? [item.address] : []), fetcher);
        const chainPairs = pairs.filter((pair) => pair.chainId?.toLowerCase() === dexChain[chain].toLowerCase());
        if (pairs.length && !chainPairs.length) warnings.push(`DexScreener returned no chain-matching pairs for ${chain}.`);
        for (const candidate of batch) {
          const pair = candidate.address ? selectBestPair(chainPairs, candidate.address) : undefined;
          if (pair) output.set(candidate.id, mergeDexPair(candidate, pair));
        }
      } catch (error) {
        warnings.push(`DexScreener ${chain} enrichment failed: ${error instanceof Error ? error.message : "unknown provider error"}`);
      }
    }
  }
  return { candidates: candidates.map((candidate) => output.get(candidate.id)!), warnings };
}
