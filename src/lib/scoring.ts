import type { TokenCandidate } from "@/lib/domain";

export type TokenScoreBreakdown = {
  socialMomentum: number | null;
  narrativeStrength: number | null;
  liquidity: number | null;
  holderDistribution: number | null;
  marketActivity: number | null;
  earlyDiscovery: number | null;
  total: number | null;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (n: number | null | undefined) => n == null ? null : clamp(n);

/** Weights: social .20, narrative .20, liquidity .20, holders .15, activity .15, early discovery .10. Missing dimensions are omitted and remaining weights renormalized. */
export function scoreApprovedToken(candidate: TokenCandidate, now = Date.now()): TokenScoreBreakdown {
  const m = candidate.metrics;
  const liquidityRatio = m.marketCapUsd && m.liquidityUsd != null ? m.liquidityUsd / m.marketCapUsd : null;
  const volumeRatio = m.marketCapUsd && m.volume24hUsd != null ? m.volume24hUsd / m.marketCapUsd : null;
  const top10 = m.top10HolderPct;
  const ageHours = m.poolCreatedAt ? Math.max(0, (now - Date.parse(m.poolCreatedAt)) / 3_600_000) : null;
  const parts: Array<[keyof Omit<TokenScoreBreakdown, "total">, number | null, number]> = [
    ["socialMomentum", pct(candidate.socialMomentumScore), 0.2],
    ["narrativeStrength", pct(candidate.narrativeStrengthScore), 0.2],
    ["liquidity", liquidityRatio == null ? null : clamp((liquidityRatio / 0.5) * 100), 0.2],
    ["holderDistribution", top10 == null ? null : clamp(100 - top10), 0.15],
    ["marketActivity", volumeRatio == null ? null : clamp(volumeRatio * 500), 0.15],
    ["earlyDiscovery", ageHours == null ? null : ageHours <= 4 ? 100 : ageHours <= 24 ? 70 : ageHours <= 168 ? 35 : 10, 0.1],
  ];
  const available = parts.filter(([, value]) => value != null);
  const totalWeight = available.reduce((sum, [, , weight]) => sum + weight, 0);
  const total = totalWeight ? available.reduce((sum, [, value, weight]) => sum + value! * weight, 0) / totalWeight : null;
  return Object.fromEntries([...parts.map(([key, value]) => [key, value]), ["total", total]]) as TokenScoreBreakdown;
}
