import { describe, expect, it } from "vitest";
import { classifyWeb3GameSignal, extractWeb3GameChain, normalizeCtoCandidate, normalizeGtdOpportunity, normalizeNftOpportunity, normalizeNarrative } from "@/lib/classification";
import type { GtdOpportunity, Narrative, NftOpportunity, TokenCandidate } from "@/lib/domain";

const now = Date.now();
const nft = (overrides: Partial<NftOpportunity> = {}): NftOpportunity => ({ id: "nft-1", name: "Sample", chain: "base", sourcePosts: [], discoveredAt: new Date(now).toISOString(), mintAt: new Date(now + 3600000).toISOString(), status: "upcoming", kind: "free", mintPriceUsd: 0, securityStatus: "pending", confidence: 50, demo: false, ...overrides });
const gtd = (overrides: Partial<GtdOpportunity> = {}): GtdOpportunity => ({ id: "gtd-1", name: "Sample GTD", chain: "ethereum", sourcePosts: [], status: "officially-confirmed", conditions: [], officialEvidenceVerified: false, lastCheckedAt: new Date(now).toISOString(), confidence: 90, demo: false, ...overrides });
const post = { externalId: "post-1", text: "A narrative post", sourceUrl: "https://x.com/example/status/1", author: "author1", publishedAt: new Date(now).toISOString(), likes: 2, reposts: 3, replies: 1 };
const narrative = (posts: Narrative["sourcePosts"]): Narrative => ({ id: "narrative-1", category: "AI agents", mentionCount: 100, uniqueAuthors: 90, engagement: 1000, growthPct: 10, accelerationScore: 80, securityPassRatio: null, sourcePosts: posts, lastUpdatedAt: new Date(now).toISOString(), demo: false });


describe("mint classification", () => {
  it("does not call unknown price free and separates free, conditional-free, low-cost, and paid", () => {
    expect(normalizeNftOpportunity(nft({ mintPriceUsd: null }), now).kind).toBe("unknown");
    expect(normalizeNftOpportunity(nft({ mintPriceUsd: 0 }), now).kind).toBe("free");
    expect(normalizeNftOpportunity(nft({ mintPriceUsd: 0, platformFeeUsd: 1 }), now).kind).toBe("conditional-free");
    expect(normalizeNftOpportunity(nft({ mintPriceUsd: 2 }), now).kind).toBe("low-cost");
    expect(normalizeNftOpportunity(nft({ mintPriceUsd: 10 }), now).kind).toBe("paid");
  });
  it("derives upcoming/live/ended only when timestamp data is present", () => {
    expect(normalizeNftOpportunity(nft({ mintAt: new Date(now - 3600000).toISOString() }), now).status).toBe("live");
    expect(normalizeNftOpportunity(nft({ mintAt: new Date(now - 7200000).toISOString(), mintEndsAt: new Date(now - 3600000).toISOString() }), now).status).toBe("ended");
    expect(normalizeNftOpportunity(nft({ mintAt: undefined, status: "unverified" }), now).status).toBe("unverified");
  });
});

describe("GTD and CTO evidence", () => {
  it("downgrades an unsupported GTD official claim", () => {
    expect(normalizeGtdOpportunity(gtd()).status).toBe("unverified");
    const official = { ...post, sourceType: "official-project" as const, verifiedOfficialAccount: true };
    expect(normalizeGtdOpportunity(gtd({ sourcePosts: [official], officialEvidenceUrl: official.sourceUrl, officialEvidenceVerified: true })).status).toBe("officially-confirmed");
  });
  it("does not allow a CTO label to become verified without independent evidence", () => {
    const candidate: TokenCandidate = { id: "token-cto", name: "Sample", symbol: "S", address: "0x0000000000000000000000000000000000000001", chain: "ethereum", metrics: {}, discoveredAt: new Date(now).toISOString(), sourcePosts: [post], ctoStatus: "verified", ctoEvidence: "Evidence summary", ctoEvidenceAccountCount: 1, originalTeamAbandoned: true, communityAccount: "@community", ctoContradicted: false, impersonationRisk: false, demo: false };
    expect(normalizeCtoCandidate(candidate).ctoStatus).toBe("unverified");
    expect(normalizeCtoCandidate({ ...candidate, impersonationRisk: true }).ctoStatus).toBe("rejected");
  });
});

describe("narrative deduplication", () => {
  it("deduplicates original posts before deriving counts and engagement", () => {
    const duplicate = { ...post, text: "Same content" };
    const unique = { ...post, externalId: "post-2", sourceUrl: "https://x.com/example/status/2", author: "author2", likes: 10, reposts: 1, replies: 0 };
    const normalized = normalizeNarrative(narrative([post, duplicate, unique]));
    expect(normalized.sourcePosts).toHaveLength(2);
    expect(normalized.mentionCount).toBe(2);
    expect(normalized.uniqueAuthors).toBe(2);
    expect(normalized.engagement).toBe(17);
  });
});

describe("Web3 game signal classification", () => {
  it("labels common game discovery signals without asserting verification", () => {
    expect(classifyWeb3GameSignal("Web3 game closed beta opens today")).toBe("playtest");
    expect(classifyWeb3GameSignal("P2E game launch for the season")).toBe("play-to-earn");
    expect(classifyWeb3GameSignal("Fully onchain game update")).toBe("onchain-game");
    expect(classifyWeb3GameSignal("Web3 gaming community update")).toBe("gaming-update");
  });
  it("extracts a chain only when one explicit game chain is mentioned", () => {
    expect(extractWeb3GameChain("Web3 game playtest on Ronin")).toBe("ronin");
    expect(extractWeb3GameChain("Fully onchain game on Base")).toBe("base");
    expect(extractWeb3GameChain("Web3 game on Ronin and on Base")).toBeUndefined();
    expect(extractWeb3GameChain("Web3 game on an unreported chain")).toBeUndefined();
  });
});
