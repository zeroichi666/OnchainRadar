import { describe, expect, it } from "vitest";
import type { Narrative, SocialPost, TokenCandidate } from "@/lib/domain";
import { buildSocialPostRows, mergeNarrativeHistory, mergeTokenCandidateHistory } from "@/lib/server/social-persistence";

const fetchedAt = "2026-10-17T11:14:00.000Z";
const sixPosts: SocialPost[] = [
  { externalId: "2111409268926677091", author: "Emma_Telly_", sourceUrl: "https://x.com/Emma_Telly_/status/2111409268926677091", text: "Giving away 5GTD and 10 FCFS spots for @wormlings_nft by @i_am_kofit. Chain: Ethereum. Supply: 2000. Mint Date: TBD. Mint Price: TBD. To win: follow, RT, tag a friend.", publishedAt: "2026-10-17T10:49:32.000Z", likes: 8, reposts: 7, replies: 9 },
  { externalId: "2111410627348509162", author: "Jennifer_Verse", sourceUrl: "https://x.com/Jennifer_Verse/status/2111410627348509162", text: "FREE MINT GIVEAWAY — @InkBubbleCats. 10 GTD + 50 FCFS. Follow @InkBubbleCats and @Jennifer_Verse. Like &amp; RT. Drop your wallet address below. Ends in 24 hours.", publishedAt: "2026-10-17T10:54:56.000Z", likes: 49, reposts: 37, replies: 52 },
  { externalId: "2110656944935514562", author: "ComputersRh", sourceUrl: "https://x.com/ComputersRh/status/2110656944935514562", text: "Today is mint day.\n\nhttps://t.co/NXFjqkh9d8\nComputersRH NFT, FREE, 3,333 supply\n\n• GTD: 4 PM UTC\n• FCFS: 7 PM UTC\n• Public: 10 PM UTC\n\nCreators: add your EVM wallet at https://t.co/SD6SVPAJyL before 12 PM UTC. https://t.co/ZqybadsaNP", publishedAt: "2026-10-15T09:00:04.000Z", likes: 402, reposts: 32, replies: 119 },
  { externalId: "2108823799999221862", author: "Nakameowdough", sourceUrl: "https://x.com/Nakameowdough/status/2108823799999221862", text: "Day 33\n\n$AMC 2.65B\n$MEME 13.2M\n\nFor any trade to work, there has to be an extremely emotional counter party.\n\nAMC holders have visceral hatred for Robinhood.\n\nCrypto traders hate any coin they aren't in.\n\nThe LONG ecosystem will go from strength to strength, and new MEMEFI financial primitives will be born.\n\nIt's going to be a movie.\n\nFlip the stock", publishedAt: "2026-10-10T07:35:48.000Z", likes: 30, reposts: 6, replies: 5 },
  { externalId: "2111408388324131242", author: "Shelly87120880", sourceUrl: "https://x.com/Shelly87120880/status/2111408388324131242", text: "Discover MEMEcoin $MEME in the crypto airdrop space. This Solana token, coin and memecoin is worth a look for fans of the $SOL ecosystem. CA=3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg", publishedAt: "2026-10-17T10:46:02.000Z", likes: 0, reposts: 0, replies: 2 },
  { externalId: "2110190220968935741", author: "langgoumode", sourceUrl: "https://x.com/langgoumode/status/2110190220968935741", text: "A genuine memecoin. New #solana runner. $Unicorn 4dLxcTxJQnkMmCKkkVoLcKgsRjj7CpGJYuwVU1repump", publishedAt: "2026-10-14T02:05:28.000Z", likes: 5, reposts: 2, replies: 0 },
];

describe("social persistence serializer", () => {
  it("persists the six existing X IDs with their exact source links and metrics", () => {
    const rows = buildSocialPostRows(sixPosts, fetchedAt);
    expect(rows).toHaveLength(6);
    const byId = new Map(rows.map((row) => [row.external_post_id, row]));
    expect(byId.get("2111410627348509162")).toMatchObject({ platform: "x", url: "https://x.com/Jennifer_Verse/status/2111410627348509162", fetched_at: fetchedAt });
    expect(byId.get("2111410627348509162")?.engagement_metrics).toEqual({ likes: 49, reposts: 37, replies: 52 });
    expect(byId.get("2111408388324131242")?.engagement_metrics).toEqual({ likes: 0, reposts: 0, replies: 2 });
  });

  it("stores detected areas and source-based ticker/contract grouping metadata", () => {
    const rows = buildSocialPostRows(sixPosts, fetchedAt);
    const byId = new Map(rows.map((row) => [row.external_post_id, row]));
    expect(byId.get("2111409268926677091")?.extracted_entities).toMatchObject({ claimStatus: "detected", sourceLinkStatus: "available", candidateAreas: ["gtd-mint"], groupingKeys: ["project:wormlings_nft"] });
    expect(byId.get("2111410627348509162")?.extracted_entities).toMatchObject({ claimStatus: "detected", candidateAreas: ["free-mint", "gtd-mint"] });
    expect(byId.get("2110656944935514562")?.extracted_entities).toMatchObject({ claimStatus: "detected", candidateAreas: ["free-mint", "gtd-mint"] });
    expect(byId.get("2111408388324131242")?.extracted_entities).toMatchObject({ claimStatus: "detected", candidateAreas: ["meme-coin"], tickers: ["MEME"] });
    expect((byId.get("2111408388324131242")?.extracted_entities as Record<string, unknown>).groupingKeys).toEqual(expect.arrayContaining(["ticker:MEME", "contract:3j92g6mygezuq25atdy8xpssch7hsn33pjh31zqp61rg"]));
  });

  it("deduplicates the same post ID and keeps an existing permalink if a duplicate lacks one", () => {
    const [post] = sixPosts;
    const rows = buildSocialPostRows([post, { ...post, text: "Short duplicate copy", sourceUrl: undefined }], fetchedAt);
    expect(rows).toHaveLength(1);
    expect(rows[0].external_post_id).toBe(post.externalId);
    expect(rows[0].url).toBe(post.sourceUrl);
    expect(rows[0].id).toBe(buildSocialPostRows([post], fetchedAt)[0].id);
    const reverse = buildSocialPostRows([{ ...post, sourceUrl: undefined, likes: undefined }, post], fetchedAt);
    expect(reverse[0].url).toBe(post.sourceUrl);
    expect((reverse[0].engagement_metrics as Record<string, number>).likes).toBe(post.likes);
  });

  it("does not synthesize a source URL when the source record has none", () => {
    const [post] = sixPosts;
    const rows = buildSocialPostRows([{ ...post, sourceUrl: undefined }], fetchedAt);
    expect(rows[0].url).toBe(null);
    expect((rows[0].extracted_entities as Record<string, unknown>).sourceLinkStatus).toBe("missing");
    expect(JSON.stringify(rows[0].extracted_entities)).not.toContain("x.com");
  });

  it("merges fresh narrative results with all stored historical posts without duplicating IDs", () => {
    const asNarrative = (sourcePosts: SocialPost[], lastUpdatedAt: string): Narrative => ({
      id: "agent-reach-x-nft", category: "NFT mints", keywords: ["free mint NFT"],
      mentionCount: sourcePosts.length, uniqueAuthors: null, engagement: null,
      growthPct: null, accelerationScore: null, securityPassRatio: null,
      sourcePosts, lastUpdatedAt, demo: false,
    });
    const nextPost: SocialPost = {
      externalId: "new-today-post", author: "new_author", text: "FREE MINT @NewProject",
      publishedAt: "2026-10-17T12:00:00.000Z",
    };
    const merged = mergeNarrativeHistory(
      asNarrative(sixPosts, "2026-10-17T11:14:00.000Z"),
      asNarrative([{ ...sixPosts[1], sourceUrl: undefined }, nextPost], "2026-10-17T12:00:00.000Z"),
    );

    expect(merged.sourcePosts).toHaveLength(7);
    expect(merged.sourcePosts.find((post) => post.externalId === sixPosts[1].externalId)?.sourceUrl).toBe(sixPosts[1].sourceUrl);
    expect(merged.sourcePosts.some((post) => post.externalId === sixPosts[2].externalId)).toBe(true);
    expect(merged.sourcePosts.some((post) => post.externalId === nextPost.externalId)).toBe(true);
    expect(merged.mentionCount).toBe(7);
    expect(merged.lastUpdatedAt).toBe("2026-10-17T12:00:00.000Z");
  });

  it("keeps existing candidate identity and market metrics when the same contract gains a new source", () => {
    const existing: TokenCandidate = {
      id: "stored-candidate", name: "Stored token name", symbol: "TEST", chain: "base",
      address: "0x1111111111111111111111111111111111111111", metrics: { liquidityUsd: 5000 },
      discoveredAt: "2026-10-15T09:00:00.000Z", sourcePosts: [sixPosts[2]], ctoStatus: "none", demo: false,
    };
    const incoming: TokenCandidate = {
      ...existing, id: "worker-candidate", name: "$TEST", metrics: {},
      discoveredAt: "2026-10-17T12:00:00.000Z", sourcePosts: [sixPosts[1]],
    };
    const merged = mergeTokenCandidateHistory(existing, incoming);
    expect(merged.id).toBe(existing.id);
    expect(merged.name).toBe(existing.name);
    expect(merged.metrics).toEqual(existing.metrics);
    expect(merged.discoveredAt).toBe(existing.discoveredAt);
    expect(merged.sourcePosts).toHaveLength(2);
  });
});
