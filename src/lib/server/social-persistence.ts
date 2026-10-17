import { createHash } from "node:crypto";
import type { Narrative, SocialPost, TokenCandidate } from "@/lib/domain";
import { mergeSocialPosts, socialReviewPersistenceMetadata } from "@/lib/social-review";

function postKey(post: SocialPost): string {
  if (post.externalId) return `x:${post.externalId}`;
  if (post.sourceUrl) return `url:${post.sourceUrl}`;
  return `text:${(post.author ?? "").toLowerCase()}|${post.publishedAt ?? ""}|${post.text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export function buildSocialPostRows(posts: SocialPost[], fetchedAt: string): Record<string, unknown>[] {
  const unique = new Map<string, SocialPost>();
  for (const post of posts) {
    const key = postKey(post);
    const existing = unique.get(key);
    unique.set(key, existing ? mergeSocialPosts(existing, post) : post);
  }
  return [...unique.entries()].map(([key, post]) => ({
    id: createHash("sha256").update(key).digest("hex"),
    platform: "x",
    external_post_id: post.externalId ?? null,
    author: post.author ?? null,
    text: post.text,
    url: post.sourceUrl ?? null,
    published_at: post.publishedAt ?? null,
    engagement_metrics: {
      ...(post.likes == null ? {} : { likes: post.likes }),
      ...(post.reposts == null ? {} : { reposts: post.reposts }),
      ...(post.replies == null ? {} : { replies: post.replies }),
    },
    extracted_entities: socialReviewPersistenceMetadata(post),
    fetched_at: fetchedAt,
  }));
}

export function mergeNarrativeHistory(existing: Narrative, incoming: Narrative): Narrative {
  const posts = new Map<string, SocialPost>();
  for (const post of [...existing.sourcePosts, ...incoming.sourcePosts]) {
    const key = postKey(post);
    const previous = posts.get(key);
    posts.set(key, previous ? mergeSocialPosts(previous, post) : post);
  }
  const sourcePosts = [...posts.values()].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  const latestUpdate = Date.parse(existing.lastUpdatedAt) >= Date.parse(incoming.lastUpdatedAt) ? existing.lastUpdatedAt : incoming.lastUpdatedAt;
  const completeAuthors = sourcePosts.length > 0 && sourcePosts.every((post) => Boolean(post.author));
  const completeEngagement = sourcePosts.length > 0 && sourcePosts.every((post) => post.likes != null && post.reposts != null && post.replies != null);

  return {
    ...existing,
    ...incoming,
    keywords: [...new Set([...(existing.keywords ?? []), ...(incoming.keywords ?? [])])].slice(0, 100),
    mentionCount: Math.max(existing.mentionCount ?? 0, incoming.mentionCount ?? 0, sourcePosts.length),
    uniqueAuthors: completeAuthors
      ? new Set(sourcePosts.map((post) => post.author!.toLowerCase())).size
      : Math.max(existing.uniqueAuthors ?? 0, incoming.uniqueAuthors ?? 0) || null,
    engagement: completeEngagement
      ? sourcePosts.reduce((sum, post) => sum + post.likes! + post.reposts! + post.replies!, 0)
      : incoming.engagement ?? existing.engagement,
    growthPct: incoming.growthPct ?? existing.growthPct,
    accelerationScore: incoming.accelerationScore ?? existing.accelerationScore,
    securityPassRatio: incoming.securityPassRatio ?? existing.securityPassRatio,
    contractMentionCount: Math.max(existing.contractMentionCount ?? 0, incoming.contractMentionCount ?? 0) || null,
    discoveredTokenCount: Math.max(existing.discoveredTokenCount ?? 0, incoming.discoveredTokenCount ?? 0) || null,
    sourcePosts,
    timeSeries: [...new Map([...(existing.timeSeries ?? []), ...(incoming.timeSeries ?? [])].map((point) => [point.at, point])).values()].slice(-100),
    lastUpdatedAt: latestUpdate,
    demo: false,
  };
}

export function mergeTokenCandidateHistory(existing: TokenCandidate, incoming: TokenCandidate): TokenCandidate {
  const posts = new Map<string, SocialPost>();
  for (const post of [...existing.sourcePosts, ...incoming.sourcePosts]) {
    const key = postKey(post);
    const previous = posts.get(key);
    posts.set(key, previous ? mergeSocialPosts(previous, post) : post);
  }
  const sourcePosts = [...posts.values()];
  const completeEngagement = sourcePosts.length > 0 && sourcePosts.every((post) => post.likes != null && post.reposts != null && post.replies != null);
  return {
    ...incoming,
    ...existing,
    sourcePosts,
    metrics: existing.metrics,
    discoveredAt: Date.parse(existing.discoveredAt) <= Date.parse(incoming.discoveredAt) ? existing.discoveredAt : incoming.discoveredAt,
    xMentionCount: Math.max(existing.xMentionCount ?? 0, incoming.xMentionCount ?? 0, sourcePosts.length),
    xEngagement: completeEngagement
      ? sourcePosts.reduce((sum, post) => sum + post.likes! + post.reposts! + post.replies!, 0)
      : existing.xEngagement ?? incoming.xEngagement,
  };
}
