import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Narrative, SocialPost } from "@/lib/domain";
import { buildSocialReviewQueue } from "@/lib/social-review";
import { SocialReviewCard, SocialReviewSection } from "@/components/social-review-queue";

const syncedAt = "2026-10-17T11:07:36.700Z";
const sourcePost: SocialPost = {
  externalId: "2111410627348509162",
  author: "Jennifer_Verse",
  sourceUrl: "https://x.com/Jennifer_Verse/status/2111410627348509162",
  text: "FREE MINT GIVEAWAY — @InkBubbleCats. 10 GTD + 50 FCFS.",
  publishedAt: "2026-10-17T10:54:56.000Z",
  likes: 49,
  reposts: 37,
  replies: 52,
};
const sourceNarrative: Narrative = {
  id: "nft", category: "NFT mints", keywords: ["FCFS mint"], mentionCount: 1,
  uniqueAuthors: 1, engagement: 138, growthPct: null, accelerationScore: null,
  securityPassRatio: null, sourcePosts: [sourcePost], lastUpdatedAt: syncedAt, demo: false,
};
const [claim] = buildSocialReviewQueue([sourceNarrative]);

describe("social claim detection UI", () => {
  it("shows one detected group with the actual source ID, wording, and X permalink", () => {
    const markup = renderToStaticMarkup(createElement(SocialReviewCard, { item: claim }));
    expect(markup).toContain("Detected claim · wording only");
    expect(markup).toContain("@InkBubbleCats");
    expect(markup).toContain("2111410627348509162");
    expect(markup).toContain("GTD Mint claim detected");
    expect(markup).toContain("49 likes");
    expect(markup).toContain('href="https://x.com/Jennifer_Verse/status/2111410627348509162"');
    expect(markup).toContain("Open original X post");
    expect(markup).toContain("not verified here");
    expect(markup).not.toContain("Unverified · review only");
    expect(markup).not.toContain("Verified opportunity");
  });

  it("shows all unique sources inside one ticker group and filters correctly by category", () => {
    const memePosts: SocialPost[] = [
      { externalId: "2108823799999221862", author: "Nakameowdough", sourceUrl: "https://x.com/Nakameowdough/status/2108823799999221862", text: "$MEME 13.2M. The LONG ecosystem will go from strength to strength.", publishedAt: "2026-10-10T07:35:48.000Z" },
      { externalId: "2111408388324131242", author: "Shelly87120880", sourceUrl: "https://x.com/Shelly87120880/status/2111408388324131242", text: "Discover MEMEcoin $MEME on Solana. CA=3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg. Worth a look.", publishedAt: "2026-10-17T10:46:02.000Z" },
    ];
    const memeNarrative: Narrative = {
      ...sourceNarrative, id: "meme", category: "Meme coins", keywords: ["new meme coin"],
      mentionCount: 2, uniqueAuthors: 2, sourcePosts: memePosts,
    };
    const memeGroup = buildSocialReviewQueue([memeNarrative])[0];
    const markup = renderToStaticMarkup(createElement(SocialReviewCard, { item: memeGroup }));
    const section = renderToStaticMarkup(createElement(SocialReviewSection, { items: [memeGroup], area: "meme-coin", initialDate: "2026-10-17" }));
    expect(memeGroup.tickers).toEqual(["MEME"]);
    expect(memeGroup.sourcePosts).toHaveLength(2);
    expect((markup.match(/href="https:\/\/x\.com\//g) ?? []).length).toBe(2);
    expect(markup).toContain("2108823799999221862");
    expect(markup).toContain("2111408388324131242");
    expect(section).toContain("Public meme-call signal");
    expect(section).toContain("1 grouped record · 1 source post");
    expect(section).toContain("Filter social posts by date (WIB)");
    expect(section).toContain("Today · WIB");
    expect(section).toContain("All history");
  });

  it("does not fabricate an X link when a post has no source URL", () => {
    const [withoutUrl] = buildSocialReviewQueue([{ ...sourceNarrative, sourcePosts: [{ ...sourcePost, sourceUrl: undefined }] }]);
    const markup = renderToStaticMarkup(createElement(SocialReviewCard, { item: withoutUrl }));
    expect(markup).toContain("X source link unavailable");
    expect(markup).not.toContain("<a ");
  });

  it("shows an explicit empty CTO detection section and a grouped narrative view", () => {
    const ctoMarkup = renderToStaticMarkup(createElement(SocialReviewSection, { items: [claim], area: "cto", initialDate: "2026-10-17" }));
    expect(ctoMarkup).toContain("CTO claim detected");
    expect(ctoMarkup).toContain("No explicit CTO wording was detected");
    expect(ctoMarkup).toContain("0 grouped records · 0 source posts");
    const allMarkup = renderToStaticMarkup(createElement(SocialReviewSection, { items: [claim], area: "all", initialDate: "2026-10-17" }));
    expect(allMarkup).toContain("Detected X claim groups");
    expect(allMarkup).toContain("1 grouped record · 1 source post");
  });
});
