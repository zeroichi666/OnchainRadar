import type { Narrative, SocialClaimReview, SocialPost } from "@/lib/domain";
import { dayKeyInTimeZone } from "@/lib/local-day";

const SIGNAL_PATTERNS = {
  freeMint: /\bfree\s+(?:nft\s+)?mint\b|\b(?:mint[\s\S]{0,180}\bfree\b|free[\s\S]{0,180}\bmint\b)/i,
  gtd: /(?:\b|(?<=\d))GTD\b|\bguaranteed\b.{0,40}\b(?:mint|spot|allocation)\b/i,
  fcfs: /\bFCFS\b/i,
  giveaway: /\b(?:giveaway|giving\s+away|to\s+win)\b/i,
  meme: /\b(?:meme[ -]?coin|memefi)\b|\$MEME\b/i,
  publicMemeCall: /\b(?:worth\s+a\s+look|discover|new\s+(?:#[a-z]+\s+)?(?:solana\s+)?runner|go(?:ing)?\s+from\s+strength\s+to\s+strength|to\s+the\s+moon|ape\s+in|accumulate|buy\s+now)\b/i,
  cto: /\bCTO\b|\bcommunity\s+(?:takeover|took\s+over|has\s+taken\s+over|led\s+takeover)\b|\b(?:dev|developer|original\s+developer)(?:\s+has)?\s+(?:abandoned|sold|left)\b/i,
} as const;

const CHAIN_NAMES = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"] as const;
export type SocialClaimSignal = SocialClaimReview["claimSignals"][number];
export type SocialReviewArea = SocialClaimReview["candidateAreas"][number];

type SocialClaimClassification = {
  claimSignals: SocialClaimSignal[];
  candidateAreas: SocialReviewArea[];
  tickers: string[];
  contractAddresses: string[];
  chainClaims: string[];
  groupingKeys: string[];
  labels: string[];
};

type PostBundle = {
  post: SocialPost;
  originCategories: Set<string>;
  originQueries: Set<string>;
  syncedAt: string;
};

type MutableGroup = {
  id: string;
  groupingKeys: Set<string>;
  labels: Set<string>;
  candidateAreas: Set<SocialReviewArea>;
  claimSignals: Set<SocialClaimSignal>;
  sourcePosts: Map<string, SocialPost>;
  originCategories: Set<string>;
  originQueries: Set<string>;
  syncedAt: string;
  tickers: Set<string>;
  contractAddresses: Set<string>;
  chainClaims: Set<string>;
};

function cleanText(text: string): string {
  return text.replace(/&amp;/gi, "&");
}

function stablePostKey(post: SocialPost): string {
  if (post.externalId) return `x:${post.externalId}`;
  if (post.sourceUrl) return `url:${post.sourceUrl}`;
  return `text:${(post.author ?? "").toLowerCase()}|${post.publishedAt ?? ""}|${post.text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export function mergeSocialPosts(existing: SocialPost, incoming: SocialPost): SocialPost {
  const longerText = incoming.text.length > existing.text.length ? incoming.text : existing.text;
  return {
    ...existing,
    ...incoming,
    externalId: existing.externalId ?? incoming.externalId,
    text: longerText,
    sourceUrl: incoming.sourceUrl ?? existing.sourceUrl,
    author: existing.author ?? incoming.author,
    authorUrl: incoming.authorUrl ?? existing.authorUrl,
    publishedAt: existing.publishedAt ?? incoming.publishedAt,
    likes: incoming.likes ?? existing.likes,
    reposts: incoming.reposts ?? existing.reposts,
    replies: incoming.replies ?? existing.replies,
    sourceType: incoming.sourceType ?? existing.sourceType,
    verifiedOfficialAccount: incoming.verifiedOfficialAccount ?? existing.verifiedOfficialAccount,
  };
}

function extractTickers(text: string): string[] {
  return [...new Set([...text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/g)].map((match) => match[1].toUpperCase()))];
}

function extractContracts(text: string): string[] {
  const explicit = [...text.matchAll(/\b(?:ca|contract(?:\s+address)?|address)\s*[:=]\s*([A-Za-z0-9]{32,50})\b/gi)].map((match) => match[1]);
  const addressLike = [...text.matchAll(/(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,50}(?![A-Za-z0-9])/g)].map((match) => match[0]);
  return [...new Set([...explicit, ...addressLike])];
}

function projectIdentity(post: SocialPost, text: string): { key: string; label: string } {
  const handle = text.match(/@([A-Za-z0-9_]{2,30})/)?.[1];
  const namedNft = text.match(/\b([A-Za-z0-9][A-Za-z0-9_-]{2,30})\s+NFT\b/i)?.[1];
  const label = handle ? `@${handle}` : namedNft ?? post.author ?? "Project claim";
  return { key: label.replace(/^@/, "").toLowerCase(), label };
}

function canonicalGroupKey(keys: string[]): string {
  const priority: Record<string, number> = { ticker: 0, contract: 1, project: 2, post: 3 };
  return [...keys].sort((a, b) => {
    const aPriority = priority[a.split(":", 1)[0]] ?? 9;
    const bPriority = priority[b.split(":", 1)[0]] ?? 9;
    return aPriority - bPriority || a.localeCompare(b);
  })[0] ?? "post:unknown";
}

export function classifySocialClaim(post: SocialPost): SocialClaimClassification {
  const text = cleanText(post.text);
  const rawTickers = extractTickers(text);
  const tickers = rawTickers.includes("MEME") ? ["MEME"] : rawTickers;
  const contractAddresses = extractContracts(text);
  const chainClaims = CHAIN_NAMES.filter((chain) => new RegExp(`\\b${chain}\\b`, "i").test(text));
  const hasMemeIdentity = tickers.length > 0 || contractAddresses.length > 0;
  const memeDetected = SIGNAL_PATTERNS.meme.test(text) && hasMemeIdentity;

  const claimSignals: SocialClaimSignal[] = [];
  const candidateAreas: SocialReviewArea[] = [];
  if (SIGNAL_PATTERNS.freeMint.test(text)) {
    claimSignals.push("free-mint-wording");
    candidateAreas.push("free-mint");
  }
  if (SIGNAL_PATTERNS.gtd.test(text)) {
    claimSignals.push("gtd-wording");
    candidateAreas.push("gtd-mint");
  }
  if (SIGNAL_PATTERNS.fcfs.test(text)) claimSignals.push("fcfs-wording");
  if (SIGNAL_PATTERNS.giveaway.test(text)) claimSignals.push("giveaway-wording");
  if (memeDetected) {
    claimSignals.push("meme-token-mentioned");
    candidateAreas.push("meme-coin");
    if (SIGNAL_PATTERNS.publicMemeCall.test(text)) claimSignals.push("public-meme-call-wording");
  }
  if (SIGNAL_PATTERNS.cto.test(text)) {
    claimSignals.push("cto-wording");
    candidateAreas.push("cto");
  }

  const groupingKeys: string[] = [];
  const labels: string[] = [];
  if (candidateAreas.includes("free-mint") || candidateAreas.includes("gtd-mint")) {
    const project = projectIdentity(post, text);
    groupingKeys.push(`project:${project.key}`);
    labels.push(project.label);
  }
  if (candidateAreas.includes("meme-coin") || candidateAreas.includes("cto")) {
    for (const ticker of tickers) groupingKeys.push(`ticker:${ticker}`);
    for (const address of contractAddresses) groupingKeys.push(`contract:${address.toLowerCase()}`);
    if (tickers.length) labels.push(...tickers.map((ticker) => `$${ticker}`));
  }
  for (const address of contractAddresses) {
    groupingKeys.push(`contract:${address.toLowerCase()}`);
  }
  if (candidateAreas.length && !groupingKeys.length) groupingKeys.push(`post:${stablePostKey(post)}`);
  if (!labels.length && contractAddresses.length) labels.push(...contractAddresses.map((address) => `Contract ${address.slice(0, 6)}…${address.slice(-4)}`));
  if (!labels.length && candidateAreas.includes("cto")) labels.push(post.author ? `CTO claim by @${post.author}` : "CTO claim");

  return {
    claimSignals: [...new Set(claimSignals)],
    candidateAreas: [...new Set(candidateAreas)],
    tickers,
    contractAddresses,
    chainClaims,
    groupingKeys: [...new Set(groupingKeys)].sort(),
    labels: [...new Set(labels)],
  };
}

function mergeGroup(target: MutableGroup, incoming: MutableGroup): void {
  for (const key of incoming.groupingKeys) target.groupingKeys.add(key);
  for (const label of incoming.labels) target.labels.add(label);
  for (const area of incoming.candidateAreas) target.candidateAreas.add(area);
  for (const signal of incoming.claimSignals) target.claimSignals.add(signal);
  for (const [key, post] of incoming.sourcePosts) {
    const existing = target.sourcePosts.get(key);
    target.sourcePosts.set(key, existing ? mergeSocialPosts(existing, post) : post);
  }
  for (const category of incoming.originCategories) target.originCategories.add(category);
  for (const query of incoming.originQueries) target.originQueries.add(query);
  for (const ticker of incoming.tickers) target.tickers.add(ticker);
  for (const address of incoming.contractAddresses) target.contractAddresses.add(address);
  for (const chain of incoming.chainClaims) target.chainClaims.add(chain);
  if (Date.parse(incoming.syncedAt) > Date.parse(target.syncedAt)) target.syncedAt = incoming.syncedAt;
}

function newGroup(id: string): MutableGroup {
  return {
    id, groupingKeys: new Set(), labels: new Set(), candidateAreas: new Set(), claimSignals: new Set(),
    sourcePosts: new Map(), originCategories: new Set(), originQueries: new Set(), syncedAt: "1970-01-01T00:00:00.000Z",
    tickers: new Set(), contractAddresses: new Set(), chainClaims: new Set(),
  };
}

export function buildSocialReviewQueue(narratives: Narrative[]): SocialClaimReview[] {
  const postBundles = new Map<string, PostBundle>();
  for (const narrative of narratives) {
    for (const post of narrative.sourcePosts) {
      const key = stablePostKey(post);
      const existing = postBundles.get(key);
      if (existing) {
        existing.post = mergeSocialPosts(existing.post, post);
        existing.originCategories.add(narrative.category);
        for (const query of narrative.keywords ?? []) existing.originQueries.add(query);
        if (Date.parse(narrative.lastUpdatedAt) > Date.parse(existing.syncedAt)) existing.syncedAt = narrative.lastUpdatedAt;
      } else {
        postBundles.set(key, {
          post,
          originCategories: new Set([narrative.category]),
          originQueries: new Set(narrative.keywords ?? []),
          syncedAt: narrative.lastUpdatedAt,
        });
      }
    }
  }

  const groupsById = new Map<string, MutableGroup>();
  const groupByKey = new Map<string, string>();
  let sequence = 0;
  for (const [postKey, bundle] of postBundles) {
    const classified = classifySocialClaim(bundle.post);
    if (!classified.candidateAreas.length) continue;
    const identityKeys = classified.groupingKeys.length ? classified.groupingKeys : [`post:${postKey}`];
    const existingIds = [...new Set(identityKeys.map((key) => groupByKey.get(key)).filter((id): id is string => Boolean(id)))].sort();
    let group = existingIds.length ? groupsById.get(existingIds[0])! : newGroup(`tmp:${sequence++}`);
    if (!groupsById.has(group.id)) groupsById.set(group.id, group);
    for (const id of existingIds.slice(1)) {
      const other = groupsById.get(id);
      if (!other || other === group) continue;
      mergeGroup(group, other);
      groupsById.delete(id);
      for (const key of other.groupingKeys) groupByKey.set(key, group.id);
    }
    for (const key of identityKeys) {
      group.groupingKeys.add(key);
      groupByKey.set(key, group.id);
    }
    for (const label of classified.labels) group.labels.add(label);
    for (const area of classified.candidateAreas) group.candidateAreas.add(area);
    for (const signal of classified.claimSignals) group.claimSignals.add(signal);
    for (const ticker of classified.tickers) group.tickers.add(ticker);
    for (const address of classified.contractAddresses) group.contractAddresses.add(address);
    for (const chain of classified.chainClaims) group.chainClaims.add(chain);
    const existingPost = group.sourcePosts.get(postKey);
    group.sourcePosts.set(postKey, existingPost ? mergeSocialPosts(existingPost, bundle.post) : bundle.post);
    for (const category of bundle.originCategories) group.originCategories.add(category);
    for (const query of bundle.originQueries) group.originQueries.add(query);
    if (Date.parse(bundle.syncedAt) > Date.parse(group.syncedAt)) group.syncedAt = bundle.syncedAt;
  }

  return [...groupsById.values()].map((group) => {
    const sourcePosts = [...group.sourcePosts.values()].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
    const sourceCount = sourcePosts.filter((post) => Boolean(post.sourceUrl)).length;
    const sourceStatus: SocialClaimReview["sourceStatus"] = sourceCount === sourcePosts.length ? "available" : sourceCount === 0 ? "missing" : "partial";
    const groupingKeys = [...group.groupingKeys].sort();
    return {
      id: `claim:${canonicalGroupKey(groupingKeys)}`,
      groupingKeys,
      label: [...group.labels].sort().join(" / ") || canonicalGroupKey(groupingKeys),
      status: "detected" as const,
      sourceStatus,
      originCategories: [...group.originCategories].sort(),
      originQueries: [...group.originQueries].sort(),
      syncedAt: group.syncedAt,
      claimSignals: [...group.claimSignals].sort(),
      candidateAreas: [...group.candidateAreas].sort(),
      tickers: [...group.tickers].sort(),
      contractAddresses: [...group.contractAddresses].sort(),
      chainClaims: [...group.chainClaims].sort(),
      sourcePosts,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export function filterSocialClaimsForDay(items: SocialClaimReview[], selectedDay: string): SocialClaimReview[] {
  const narratives: Narrative[] = items.flatMap((item, index) => {
    const sourcePosts = item.sourcePosts.filter((post) => dayKeyInTimeZone(post.publishedAt) === selectedDay);
    if (!sourcePosts.length) return [];
    return [{
      id: `day-filter-${index}`,
      category: item.originCategories.join(", ") || "X posts",
      keywords: item.originQueries,
      mentionCount: sourcePosts.length,
      uniqueAuthors: null,
      engagement: null,
      growthPct: null,
      accelerationScore: null,
      securityPassRatio: null,
      sourcePosts,
      lastUpdatedAt: item.syncedAt,
      demo: false,
    }];
  });
  return buildSocialReviewQueue(narratives);
}

export function socialReviewPersistenceMetadata(post: SocialPost): Record<string, unknown> {
  const claim = classifySocialClaim(post);
  return {
    claimStatus: claim.candidateAreas.length ? "detected" : "no-match",
    sourceLinkStatus: post.sourceUrl ? "available" : "missing",
    candidateAreas: claim.candidateAreas,
    claimSignals: claim.claimSignals,
    groupingKeys: claim.groupingKeys,
    tickers: claim.tickers,
    contractAddresses: claim.contractAddresses,
    chainClaims: claim.chainClaims,
  };
}
