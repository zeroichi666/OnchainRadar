import { describe, expect, it } from "vitest";
import type { Narrative, SocialPost } from "@/lib/domain";
import { buildSocialReviewQueue, classifySocialClaim, filterSocialClaimsForDay, socialReviewPersistenceMetadata } from "@/lib/social-review";

const syncedAt = "2026-10-17T11:07:36.700Z";
const post = (externalId: string, author: string, text: string, sourceUrl: string, publishedAt = syncedAt): SocialPost => ({ externalId, author, text, sourceUrl, publishedAt });
const narrative = (id: string, category: string, keywords: string[], posts: SocialPost[]): Narrative => ({
  id, category, keywords, mentionCount: posts.length, uniqueAuthors: posts.length, engagement: null,
  growthPct: null, accelerationScore: null, securityPassRatio: null, sourcePosts: posts, lastUpdatedAt: syncedAt, demo: false,
});

const wormlings = post("2111409268926677091", "Emma_Telly_", "Giving away 5GTD and 10 FCFS spots for @wormlings_nft by @i_am_kofit\n\nWormlings are pure art NFTs for pixel art collectors, they’re full of joy and whimsy, and they won’t be available for long!\n\nChain: Ethereum\nSupply: 2000\nMint Date: TBD\nMint Price: TBD\n\nTo win:\n✅Follow: @wormlings_nft, @i_am_kofit, @Emma_Telly_ \n✅RT, tag a fren and drop EVM.\n\nGL", "https://x.com/Emma_Telly_/status/2111409268926677091", "2026-10-17T10:49:32.000Z");
const inkBubbleCats = post("2111410627348509162", "Jennifer_Verse", "FREE MINT GIVEAWAY — @InkBubbleCats\n\n10 GTD + 50 FCFS\n\nFollow @InkBubbleCats and @Jennifer_Verse\nLike &amp; RT\nDrop your wallet address below.\n\nEnds in 24 hours. Good luck! https://t.co/D3VvWL421y", "https://x.com/Jennifer_Verse/status/2111410627348509162", "2026-10-17T10:54:56.000Z");
const computersRh = post("2110656944935514562", "ComputersRh", `Today is mint day. 🖥️

https://t.co/NXFjqkh9d8
ComputersRH NFT, FREE, 3,333 supply

• GTD: 4 PM UTC
• FCFS: 7 PM UTC
• Public: 10 PM UTC

Creators: add your EVM wallet at https://t.co/SD6SVPAJyL before 12 PM UTC. https://t.co/ZqybadsaNP`, "https://x.com/ComputersRh/status/2110656944935514562", "2026-10-15T09:00:04.000Z");
const nakameow = post("2108823799999221862", "Nakameowdough", "Day 33\n\n$AMC 2.65B\n$MEME 13.2M\n\nFor any trade to work, there has to be an extremely emotional counter party. \n\nAMC holders have visceral hatred for Robinhood.\n\nCrypto traders hate any coin they aren't in.\n\nThe LONG ecosystem will go from strength to strength, and new MEMEFI financial primitives will be born. \n\nIt's going to be a movie. \n\nFlip the stock 🍿", "https://x.com/Nakameowdough/status/2108823799999221862", "2026-10-10T07:35:48.000Z");
const shelly = post("2111408388324131242", "Shelly87120880", "🪙 Discover MEMEcoin $MEME in the crypto airdrop space. This Solana token, coin and memecoin is worth a look for fans of the $SOL ecosystem. \n\n CA=3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg \n\n https://t.co/o6YP8jkvNf", "https://x.com/Shelly87120880/status/2111408388324131242", "2026-10-17T10:46:02.000Z");
const unicorn = post("2110190220968935741", "langgoumode", "A genuine memecoin that the community is looking for. New #solana runner 🦄\n $Unicorn 4dLxcTxJQnkMmCKkkVoLcKgsRjj7CpGJYuwVU1repump https://t.co/bMaZdwILSf", "https://x.com/langgoumode/status/2110190220968935741", "2026-10-14T02:05:28.000Z");

const sixNarratives = [
  narrative("nft", "NFT mints", ["FCFS mint"], [wormlings, inkBubbleCats, computersRh]),
  narrative("meme", "Meme coins", ["new meme coin"], [shelly, unicorn, nakameow]),
];

function findGroup(groups: ReturnType<typeof buildSocialReviewQueue>, key: string) {
  return groups.find((group) => group.groupingKeys.includes(key));
}

describe("social claim detector and grouping", () => {
  it("detects the six actual source posts as wording claims without asserting verification", () => {
    const groups = buildSocialReviewQueue(sixNarratives);
    expect(groups).toHaveLength(5);
    expect(groups.every((group) => group.status === "detected" && group.sourceStatus === "available")).toBe(true);
    expect(groups.flatMap((group) => group.sourcePosts)).toHaveLength(6);
    expect(findGroup(groups, "project:wormlings_nft")?.candidateAreas).toContain("gtd-mint");
    expect(findGroup(groups, "project:wormlings_nft")?.candidateAreas).not.toContain("free-mint");
    expect(findGroup(groups, "project:inkbubblecats")?.candidateAreas).toEqual(expect.arrayContaining(["free-mint", "gtd-mint"]));
    expect(findGroup(groups, "project:computersrh")?.candidateAreas).toEqual(expect.arrayContaining(["free-mint", "gtd-mint"]));
    expect(groups.filter((group) => group.candidateAreas.includes("free-mint"))).toHaveLength(2);
    expect(groups.filter((group) => group.candidateAreas.includes("gtd-mint"))).toHaveLength(3);
    expect(groups.filter((group) => group.candidateAreas.includes("meme-coin"))).toHaveLength(2);
    expect(groups.filter((group) => group.candidateAreas.includes("cto"))).toHaveLength(0);
    expect(JSON.stringify(groups)).not.toMatch(/officially-confirmed|verified opportunity|security pass/i);
  });

  it("combines the same public ticker into one group and retains every unique X source", () => {
    const groups = buildSocialReviewQueue(sixNarratives);
    const meme = findGroup(groups, "ticker:MEME");
    expect(meme?.label).toContain("$MEME");
    expect(meme?.tickers).toEqual(["MEME"]);
    expect(meme?.sourcePosts.map((source) => source.externalId).sort()).toEqual([nakameow.externalId, shelly.externalId].sort());
    expect(meme?.sourcePosts.every((source) => source.sourceUrl?.startsWith("https://x.com/") === true)).toBe(true);
    expect(meme?.contractAddresses).toContain("3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg");
    expect(meme?.claimSignals).toContain("public-meme-call-wording");
    expect(findGroup(groups, "ticker:UNICORN")?.sourcePosts).toHaveLength(1);
  });

  it("deduplicates repeated source IDs and preserves a previously available link", () => {
    const duplicate = narrative("meme-duplicate", "Other", ["new meme coin", "second query"], [{ ...shelly, sourceUrl: undefined }]);
    const groups = buildSocialReviewQueue([...sixNarratives, duplicate]);
    const meme = findGroup(groups, "ticker:MEME")!;
    expect(groups).toHaveLength(5);
    expect(meme.sourcePosts.filter((source) => source.externalId === shelly.externalId)).toHaveLength(1);
    expect(meme.sourcePosts.find((source) => source.externalId === shelly.externalId)?.sourceUrl).toBe(shelly.sourceUrl);
    expect(meme.originQueries).toEqual(expect.arrayContaining(["new meme coin", "second query"]));
  });

  it("merges distinct tickers when they point to the same source-provided contract string", () => {
    const sameContractOtherTicker = post("test-only-contract-merge", "test-account", "memecoin public call $OTHER; CA=3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg", "https://x.com/test-account/status/test-only-contract-merge");
    const groups = buildSocialReviewQueue([...sixNarratives, narrative("test-only", "test", [], [sameContractOtherTicker])]);
    const merged = findGroup(groups, "ticker:MEME")!;
    expect(findGroup(groups, "ticker:OTHER")).toBe(merged);
    expect(merged.tickers).toEqual(["MEME", "OTHER"]);
    expect(merged.sourcePosts).toHaveLength(3);
  });

  it("extracts only explicit claim wording and avoids generic CTO inference", () => {
    expect(classifySocialClaim(wormlings).claimSignals).toEqual(expect.arrayContaining(["gtd-wording", "fcfs-wording", "giveaway-wording"]));
    expect(classifySocialClaim(inkBubbleCats).candidateAreas).toEqual(expect.arrayContaining(["free-mint", "gtd-mint"]));
    expect(classifySocialClaim(shelly).tickers).toEqual(["MEME"]);
    expect(classifySocialClaim(shelly).contractAddresses).toContain("3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg");
    expect(classifySocialClaim(unicorn).tickers).toEqual(["UNICORN"]);
    expect(classifySocialClaim(unicorn).contractAddresses).toContain("4dLxcTxJQnkMmCKkkVoLcKgsRjj7CpGJYuwVU1repump");
    expect(classifySocialClaim(unicorn).claimSignals).not.toContain("cto-wording");
    expect(classifySocialClaim(post("plain", "person", "A nice community project", "https://x.com/person/status/plain")).candidateAreas).toEqual([]);
  });

  it("rebuilds claim groups from only the selected WIB day, excluding historical posts in mixed groups", () => {
    const all = buildSocialReviewQueue(sixNarratives);
    const today = filterSocialClaimsForDay(all, "2026-10-17");
    expect(today.flatMap((group) => group.sourcePosts)).toHaveLength(3);
    expect(today.flatMap((group) => group.sourcePosts).every((source) => source.publishedAt && source.publishedAt >= "2026-10-16T17:00:00.000Z" && source.publishedAt < "2026-10-17T17:00:00.000Z")).toBe(true);
    expect(today.filter((group) => group.candidateAreas.includes("free-mint"))).toHaveLength(1);
    expect(today.filter((group) => group.candidateAreas.includes("gtd-mint"))).toHaveLength(2);
    const meme = findGroup(today, "ticker:MEME");
    expect(meme?.sourcePosts.map((source) => source.externalId)).toEqual([shelly.externalId]);
    expect(meme?.candidateAreas).toContain("meme-coin");
    expect(today.some((group) => group.sourcePosts.some((source) => source.externalId === computersRh.externalId))).toBe(false);
  });

  it("stores detected claim metadata without inventing or embedding source URLs", () => {
    const metadata = socialReviewPersistenceMetadata(wormlings);
    expect(metadata).toMatchObject({ claimStatus: "detected", sourceLinkStatus: "available", candidateAreas: ["gtd-mint"], groupingKeys: ["project:wormlings_nft"] });
    expect(JSON.stringify(metadata)).not.toContain("x.com");
    const noSource = socialReviewPersistenceMetadata({ ...wormlings, sourceUrl: undefined });
    expect(noSource).toMatchObject({ claimStatus: "detected", sourceLinkStatus: "missing" });
  });
});
