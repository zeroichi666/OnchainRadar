const buckets = new Map<string, { startedAt: number; count: number }>();

export function allowRateLimit(key: string, limit = 30, windowMs = 60_000, now = Date.now()): boolean {
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (now - value.startedAt >= windowMs) buckets.delete(bucketKey);
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs || now < bucket.startedAt) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function getClientIp(headers: Headers, trustForwardedFor = process.env.NODE_ENV !== "production"): string {
  const netlifyIp = headers.get("x-nf-client-connection-ip");
  if (netlifyIp) return netlifyIp.slice(0, 80);
  const forwarded = trustForwardedFor ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return (forwarded || "unknown").slice(0, 80);
}

export function clearRateLimitsForTests(): void { buckets.clear(); }
