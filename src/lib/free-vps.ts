import type { Narrative, SocialPost } from "@/lib/domain";
import { dayKeyInTimeZone, todayInTimeZone } from "@/lib/local-day";

export const FREE_VPS_CATEGORY = "Free VPS";

export type FreeVpsSignal = {
  id: string;
  post: SocialPost;
  discoveredAt: string;
};

export function getFreeVpsSignals(
  narratives: Narrative[],
  options: { includeOlder?: boolean; now?: Date } = {},
): FreeVpsSignal[] {
  const today = todayInTimeZone(options.now ?? new Date());
  const signals = narratives
    .filter((narrative) => narrative.category === FREE_VPS_CATEGORY)
    .flatMap((narrative) => narrative.sourcePosts.map((post, index) => ({
      id: `${narrative.id}:${post.externalId ?? post.sourceUrl ?? `${post.author ?? "unknown"}-${index}`}`,
      post,
      discoveredAt: narrative.lastUpdatedAt,
    })))
    .filter(({ post }) => options.includeOlder || dayKeyInTimeZone(post.publishedAt) === today);

  return signals.sort((left, right) => {
    const leftTime = Date.parse(left.post.publishedAt ?? left.discoveredAt);
    const rightTime = Date.parse(right.post.publishedAt ?? right.discoveredAt);
    return rightTime - leftTime;
  });
}
