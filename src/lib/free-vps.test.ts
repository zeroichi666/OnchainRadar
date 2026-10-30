import { describe, expect, it } from "vitest";
import type { Narrative, SocialPost } from "@/lib/domain";
import { getFreeVpsSignals } from "@/lib/free-vps";

function post(externalId: string, publishedAt?: string): SocialPost {
  return {
    externalId,
    text: `Free VPS offer ${externalId}`,
    sourceUrl: `https://x.com/provider/status/${externalId}`,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function narrative(category: string, sourcePosts: SocialPost[]): Narrative {
  return {
    id: `x-${category}`,
    category,
    keywords: [],
    mentionCount: sourcePosts.length,
    uniqueAuthors: null,
    engagement: null,
    growthPct: null,
    accelerationScore: null,
    securityPassRatio: null,
    contractMentionCount: 0,
    discoveredTokenCount: 0,
    sourcePosts,
    lastUpdatedAt: "2026-10-30T01:00:00.000Z",
    demo: false,
  };
}

describe("Free VPS X post selection", () => {
  const today = new Date("2026-10-30T04:00:00.000Z");

  it("defaults to posts published today in Jakarta and sorts newest first", () => {
    const rows = [
      narrative("Free VPS", [
        post("older", "2026-10-29T16:59:59.999Z"),
        post("today-early", "2026-10-29T17:00:00.000Z"),
        post("today-late", "2026-10-30T02:00:00.000Z"),
        post("unknown-date"),
      ]),
      narrative("Web3 Games", [post("not-vps", "2026-10-30T03:00:00.000Z")]),
    ];

    expect(getFreeVpsSignals(rows, { now: today }).map(({ post: item }) => item.externalId))
      .toEqual(["today-late", "today-early"]);
  });

  it("can include stored older and undated posts when requested", () => {
    const rows = [narrative("Free VPS", [
      post("older", "2026-10-29T16:59:59.999Z"),
      post("unknown-date"),
    ])];

    expect(getFreeVpsSignals(rows, { includeOlder: true, now: today }).map(({ post: item }) => item.externalId))
      .toEqual(["unknown-date", "older"]);
  });
});
