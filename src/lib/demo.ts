import type { DashboardPayload } from "@/lib/domain";

const now = new Date().toISOString();
const demoNft = {
  id: "demo-free-mint-placeholder", name: "Demo only — sample NFT opportunity", chain: "base" as const,
  sourcePosts: [], discoveredAt: now, status: "unverified" as const, kind: "unknown" as const,
  mintPriceUsd: null, networkFeeEstimateUsd: null, securityStatus: "pending" as const, confidence: 0,
  demo: true,
};
const demoGtd = {
  id: "demo-gtd-placeholder", name: "Demo only — sample GTD opportunity", chain: "ethereum" as const,
  sourcePosts: [], status: "unverified" as const, conditions: ["Synthetic sample; no allocation claim has been verified."], officialEvidenceVerified: false,
  lastCheckedAt: now, confidence: 0, demo: true,
};
const demoToken = {
  id: "demo-token-review-placeholder", name: "Demo only — token candidate", symbol: "SAMPLE", address: null,
  chain: "solana" as const, metrics: {}, discoveredAt: now, sourcePosts: [], xMentionCount: null, xEngagement: null,
  ctoStatus: "none" as const, demo: true,
};

export function getDemoDashboard(): DashboardPayload {
  return {
    mode: "demo",
    generatedAt: now,
    lastSuccessfulSocialSyncAt: null,
    warnings: [
      "DEMO MODE: all displayed sample records are fictional placeholders and are not real mints, tokens, social posts, or investment opportunities.",
      "Live X/Agent-Reach ingestion, Supabase storage, and provider credentials are not configured in this demo response.",
    ],
    nfts: [demoNft],
    gtd: [demoGtd],
    tokens: [],
    ctoClaims: [],
    securityQueue: [{ token: demoToken, verdict: "PENDING", reasons: ["Synthetic demo sample; no address or real security analysis exists."] }],
    securityReports: [],
    providerReports: [],
    narratives: [{
      id: "demo-narrative-placeholder", category: "Demo only — no live narrative data", mentionCount: null,
      uniqueAuthors: null, engagement: null, growthPct: null, accelerationScore: null, securityPassRatio: null,
      sourcePosts: [], lastUpdatedAt: now, demo: true,
    }],
    recentExclusions: [],
  };
}
