import type { GtdOpportunity, Narrative, NftOpportunity, SocialPost, TokenCandidate } from "@/lib/domain";

export function dedupeSocialPosts(posts: SocialPost[]): SocialPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = post.externalId ? `id:${post.externalId}` : post.sourceUrl ? `url:${post.sourceUrl}` : `text:${(post.author ?? "").toLowerCase()}|${post.publishedAt ?? ""}|${post.text.trim().replace(/\s+/g, " ").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeNftOpportunity(row: NftOpportunity, now = Date.now(), lowCostThresholdUsd = 5): NftOpportunity {
  if (row.demo) return row;
  let kind = row.kind;
  if (kind !== "giveaway") {
    if (row.mintPriceUsd == null) kind = "unknown";
    else if (row.mintPriceUsd === 0) {
      const gated = ["allowlist", "whitelist", "fcfs", "raffle", "conditional"].includes(row.eligibilityType ?? "") || Boolean(row.eligibility?.trim());
      kind = (row.platformFeeUsd ?? 0) > 0 || gated ? "conditional-free" : "free";
    } else if (row.mintPriceUsd <= lowCostThresholdUsd) kind = "low-cost";
    else kind = "paid";
  }
  let status = row.status;
  if (row.mintAt) {
    const start = Date.parse(row.mintAt);
    const end = row.mintEndsAt ? Date.parse(row.mintEndsAt) : null;
    if (Number.isFinite(start) && now < start) status = "upcoming";
    else if (end != null && Number.isFinite(end) && now > end) status = "ended";
    else if (Number.isFinite(start) && now >= start) status = "live";
  }
  return { ...row, sourcePosts: dedupeSocialPosts(row.sourcePosts), kind, status };
}

export function normalizeGtdOpportunity(row: GtdOpportunity): GtdOpportunity {
  const sourcePosts = dedupeSocialPosts(row.sourcePosts);
  const officialEvidenceMatches = Boolean(row.officialEvidenceVerified && row.officialEvidenceUrl && sourcePosts.some((post) => post.sourceUrl === row.officialEvidenceUrl && post.sourceType === "official-project" && post.verifiedOfficialAccount === true));
  const status = row.status === "officially-confirmed" && !officialEvidenceMatches ? "unverified" : row.status;
  return { ...row, sourcePosts, status };
}

export function normalizeCtoCandidate(row: TokenCandidate): TokenCandidate {
  const sourcePosts = dedupeSocialPosts(row.sourcePosts);
  let ctoStatus = row.ctoStatus;
  const hasSourceEvidence = sourcePosts.some((post) => Boolean(post.sourceUrl));
  const independentlySupported = (row.ctoEvidenceAccountCount ?? 0) >= 2;
  const contradicted = row.ctoContradicted === true || row.originalAccountStatement === "disputes";
  if (row.impersonationRisk === true) ctoStatus = "rejected";
  else if (contradicted && ctoStatus !== "none") ctoStatus = "disputed";
  else if (ctoStatus === "verified" && (!row.address || !hasSourceEvidence || !independentlySupported || row.originalTeamAbandoned !== true || !row.communityAccount || row.ctoContradicted !== false || row.impersonationRisk !== false)) ctoStatus = "unverified";
  else if (ctoStatus === "probable" && (!row.address || !hasSourceEvidence || !independentlySupported || (row.ctoConfidence ?? 0) < 60 || !row.communityAccount)) ctoStatus = "unverified";
  return { ...row, sourcePosts, ctoStatus };
}

export function normalizeNarrative(row: Narrative): Narrative {
  const sourcePosts = dedupeSocialPosts(row.sourcePosts);
  if (!sourcePosts.length) return { ...row, sourcePosts };
  const authorsComplete = sourcePosts.every((post) => Boolean(post.author));
  const engagementComplete = sourcePosts.every((post) => post.likes != null && post.reposts != null && post.replies != null);
  const uniqueAuthors = authorsComplete ? new Set(sourcePosts.map((post) => post.author!.toLowerCase())).size : null;
  const engagement = engagementComplete ? sourcePosts.reduce((sum, post) => sum + post.likes! + post.reposts! + post.replies!, 0) : null;
  return { ...row, sourcePosts, mentionCount: sourcePosts.length, uniqueAuthors, engagement };
}
