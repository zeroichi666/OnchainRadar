import { z } from "zod";

const HttpsUrlSchema = z.string().url().refine((value) => value.startsWith("https://"), "URL must use HTTPS");

export const chains = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"] as const;
export const ChainSchema = z.enum(chains);
export type Chain = z.infer<typeof ChainSchema>;

export const SocialPostSchema = z.object({
  externalId: z.string().optional(),
  text: z.string().max(4000),
  sourceUrl: HttpsUrlSchema.optional(),
  author: z.string().optional(),
  authorUrl: HttpsUrlSchema.optional(),
  publishedAt: z.string().datetime().optional(),
  likes: z.number().int().nonnegative().optional(),
  reposts: z.number().int().nonnegative().optional(),
  replies: z.number().int().nonnegative().optional(),
  sourceType: z.enum(["official-project", "third-party", "community", "unknown"]).optional(),
  verifiedOfficialAccount: z.boolean().optional(),
}).strict();
export type SocialPost = z.infer<typeof SocialPostSchema>;

const ConfidenceSchema = z.number().min(0).max(100);
export const NftOpportunitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  imageUrl: HttpsUrlSchema.optional(),
  chain: ChainSchema,
  contractAddress: z.string().max(128).optional(),
  mintContractAddress: z.string().max(128).optional(),
  website: HttpsUrlSchema.optional(),
  officialX: z.string().optional(),
  sourcePosts: z.array(SocialPostSchema).default([]),
  discoveredAt: z.string().datetime(),
  mintAt: z.string().datetime().optional(),
  mintEndsAt: z.string().datetime().optional(),
  status: z.enum(["upcoming", "live", "ended", "unverified"]),
  kind: z.enum(["free", "low-cost", "paid", "conditional-free", "giveaway", "unknown"]),
  mintPriceUsd: z.number().nonnegative().nullable().optional(),
  platformFeeUsd: z.number().nonnegative().nullable().optional(),
  networkFeeEstimateUsd: z.number().nonnegative().nullable().optional(),
  supply: z.number().int().positive().optional(),
  walletLimit: z.number().int().positive().optional(),
  eligibility: z.string().optional(),
  eligibilityType: z.enum(["public", "allowlist", "whitelist", "fcfs", "raffle", "conditional", "giveaway", "unknown"]).optional(),
  walletConnectionRequired: z.boolean().nullable().optional(),
  contractVerified: z.boolean().nullable().optional(),
  securityStatus: z.enum(["verified", "unverified", "pending", "not-applicable"]),
  lastVerifiedAt: z.string().datetime().optional(),
  confidence: ConfidenceSchema,
  demo: z.boolean().default(false),
}).strict();
export type NftOpportunity = z.infer<typeof NftOpportunitySchema>;

export const GtdOpportunitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  chain: ChainSchema,
  officialX: z.string().optional(),
  sourcePosts: z.array(SocialPostSchema).default([]),
  mintAt: z.string().datetime().optional(),
  mintPriceUsd: z.number().nonnegative().nullable().optional(),
  allocation: z.string().optional(),
  eligibility: z.string().optional(),
  transferable: z.boolean().nullable().optional(),
  paymentRequired: z.boolean().nullable().optional(),
  status: z.enum(["officially-confirmed", "third-party-reported", "unverified", "expired", "potentially-misleading"]),
  conditions: z.array(z.string()).default([]),
  officialEvidenceUrl: HttpsUrlSchema.optional(),
  officialEvidenceVerified: z.boolean().default(false),
  lastCheckedAt: z.string().datetime(),
  confidence: ConfidenceSchema,
  demo: z.boolean().default(false),
}).strict();
export type GtdOpportunity = z.infer<typeof GtdOpportunitySchema>;

export const SecurityCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  result: z.enum(["pass", "warning", "fail", "unknown"]),
  mandatory: z.boolean(),
  detail: z.string().optional(),
}).strict();
export type SecurityCheck = z.infer<typeof SecurityCheckSchema>;
export const SecurityVerdictSchema = z.enum(["PASS", "WARNING", "FAIL", "PENDING", "UNKNOWN", "STALE"]);
export type SecurityVerdict = z.infer<typeof SecurityVerdictSchema>;

export const TokenMetricsSchema = z.object({
  priceUsd: z.number().nonnegative().nullable().optional(),
  marketCapUsd: z.number().nonnegative().nullable().optional(),
  fdvUsd: z.number().nonnegative().nullable().optional(),
  liquidityUsd: z.number().nonnegative().nullable().optional(),
  volume24hUsd: z.number().nonnegative().nullable().optional(),
  change5mPct: z.number().nullable().optional(),
  change1hPct: z.number().nullable().optional(),
  change6hPct: z.number().nullable().optional(),
  change24hPct: z.number().nullable().optional(),
  buys24h: z.number().int().nonnegative().nullable().optional(),
  sells24h: z.number().int().nonnegative().nullable().optional(),
  buyers: z.number().int().nonnegative().nullable().optional(),
  sellers: z.number().int().nonnegative().nullable().optional(),
  holderCount: z.number().int().nonnegative().nullable().optional(),
  top10HolderPct: z.number().min(0).max(100).nullable().optional(),
  developerHoldingPct: z.number().min(0).max(100).nullable().optional(),
  bundleBuyPct: z.number().min(0).max(100).nullable().optional(),
  sniperConcentrationPct: z.number().min(0).max(100).nullable().optional(),
  poolCreatedAt: z.string().datetime().optional(),
  poolAddress: z.string().optional(),
  dexId: z.string().optional(),
  pairUrl: HttpsUrlSchema.optional(),
  priceSeries: z.array(z.object({ at: z.string().datetime(), priceUsd: z.number().nonnegative(), volumeUsd: z.number().nonnegative().nullable().optional() }).strict()).max(500).optional(),
}).strict();
export type TokenMetrics = z.infer<typeof TokenMetricsSchema>;

export const TokenCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  address: z.string().max(128).nullable().optional(),
  chain: ChainSchema,
  logoUrl: HttpsUrlSchema.optional(),
  metrics: TokenMetricsSchema.default({}),
  narrativeCategory: z.string().optional(),
  socialMomentumScore: z.number().min(0).max(100).nullable().optional(),
  narrativeStrengthScore: z.number().min(0).max(100).nullable().optional(),
  discoveredAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime().optional(),
  sourcePosts: z.array(SocialPostSchema).default([]),
  xMentionCount: z.number().int().nonnegative().nullable().optional(),
  xEngagement: z.number().int().nonnegative().nullable().optional(),
  ctoStatus: z.enum(["verified", "probable", "unverified", "disputed", "rejected", "none"]).default("none"),
  ctoEvidence: z.string().optional(),
  ctoConfidence: z.number().min(0).max(100).nullable().optional(),
  ctoEvidenceAccountCount: z.number().int().nonnegative().nullable().optional(),
  originalTeamAbandoned: z.boolean().nullable().optional(),
  originalAccountStatement: z.enum(["confirms", "disputes", "none", "unknown"]).optional(),
  communityAccount: z.string().optional(),
  ctoContradicted: z.boolean().nullable().optional(),
  impersonationRisk: z.boolean().nullable().optional(),
  ctoFirstDetectedAt: z.string().datetime().optional(),
  ctoLastActivityAt: z.string().datetime().optional(),
  demo: z.boolean().default(false),
}).strict();
export type TokenCandidate = z.infer<typeof TokenCandidateSchema>;

export const SecurityReportSchema = z.object({
  address: z.string(),
  chain: ChainSchema,
  checks: z.array(SecurityCheckSchema),
  checkedAt: z.string().datetime(),
  provider: z.string().min(1),
  verdict: SecurityVerdictSchema.optional(),
  flags: z.array(z.string()).default([]),
  demo: z.boolean().default(false),
}).strict();
export type SecurityReport = z.infer<typeof SecurityReportSchema>;

export const NarrativeSchema = z.object({
  id: z.string(),
  category: z.string(),
  keywords: z.array(z.string().max(80)).max(100).optional(),
  mentionCount: z.number().int().nonnegative().nullable(),
  uniqueAuthors: z.number().int().nonnegative().nullable(),
  engagement: z.number().int().nonnegative().nullable(),
  growthPct: z.number().nullable(),
  accelerationScore: z.number().min(0).max(100).nullable(),
  securityPassRatio: z.number().min(0).max(100).nullable(),
  contractMentionCount: z.number().int().nonnegative().nullable().optional(),
  discoveredTokenCount: z.number().int().nonnegative().nullable().optional(),
  independentSupportingAccounts: z.number().int().nonnegative().nullable().optional(),
  sourcePosts: z.array(SocialPostSchema),
  timeSeries: z.array(z.object({ at: z.string().datetime(), mentions: z.number().int().nonnegative(), engagement: z.number().int().nonnegative().nullable() }).strict()).max(100).optional(),
  spamSignals: z.array(z.string()).max(20).optional(),
  lastUpdatedAt: z.string().datetime(),
  demo: z.boolean().default(false),
}).strict();
export type Narrative = z.infer<typeof NarrativeSchema>;

export const SecurityReviewItemSchema = z.object({
  token: TokenCandidateSchema,
  verdict: SecurityVerdictSchema,
  reasons: z.array(z.string()),
}).strict();
export type SecurityReviewItem = z.infer<typeof SecurityReviewItemSchema>;

export const SocialClaimReviewSchema = z.object({
  id: z.string().min(1),
  groupingKeys: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
  status: z.literal("detected"),
  sourceStatus: z.enum(["available", "partial", "missing"]),
  originCategories: z.array(z.string().min(1)).min(1),
  originQueries: z.array(z.string()).default([]),
  syncedAt: z.string().datetime(),
  claimSignals: z.array(z.enum(["free-mint-wording", "gtd-wording", "fcfs-wording", "giveaway-wording", "meme-token-mentioned", "public-meme-call-wording", "cto-wording"])).min(1),
  candidateAreas: z.array(z.enum(["free-mint", "gtd-mint", "cto", "meme-coin"])).min(1),
  tickers: z.array(z.string().min(1)).default([]),
  contractAddresses: z.array(z.string().min(1)).default([]),
  chainClaims: z.array(z.string().min(1)).default([]),
  sourcePosts: z.array(SocialPostSchema).min(1),
}).strict();
export type SocialClaimReview = z.infer<typeof SocialClaimReviewSchema>;

export const DashboardPayloadSchema = z.object({
  mode: z.enum(["demo", "live"]),
  generatedAt: z.string().datetime(),
  lastSuccessfulSocialSyncAt: z.string().datetime().nullable(),
  warnings: z.array(z.string()),
  nfts: z.array(NftOpportunitySchema),
  gtd: z.array(GtdOpportunitySchema),
  tokens: z.array(TokenCandidateSchema),
  ctoClaims: z.array(SecurityReviewItemSchema),
  securityQueue: z.array(SecurityReviewItemSchema),
  securityReports: z.array(SecurityReportSchema),
  providerReports: z.array(SecurityReportSchema).default([]),
  narratives: z.array(NarrativeSchema),
  socialReviewQueue: z.array(SocialClaimReviewSchema).default([]),
  recentExclusions: z.array(z.object({ label: z.string(), reason: z.string(), at: z.string().datetime() })),
}).strict();
export type DashboardPayload = z.infer<typeof DashboardPayloadSchema>;
