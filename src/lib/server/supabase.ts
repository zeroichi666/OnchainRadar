import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NarrativeSchema, TokenCandidateSchema } from "@/lib/domain";
import type { GtdOpportunity, Narrative, NftOpportunity, SecurityReport, SocialPost, TokenCandidate } from "@/lib/domain";
import { normalizeCtoCandidate, normalizeGtdOpportunity, normalizeNarrative, normalizeNftOpportunity } from "@/lib/classification";
import type { IngestionEnvelope } from "@/lib/server/ingest-schema";
import { normalizeDatabaseTimestamp } from "@/lib/server/timestamps";
import { buildSocialPostRows, mergeNarrativeHistory, mergeTokenCandidateHistory } from "@/lib/server/social-persistence";
import { mergeSocialPosts } from "@/lib/social-review";

let client: SupabaseClient | null | undefined;
export function getSupabaseServerClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) { client = null; return client; }
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

export async function readPayloadTable(table: "radar_candidates" | "radar_nfts" | "radar_gtd" | "radar_narratives", limit = 100): Promise<{ payload: unknown }[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select("payload").order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Supabase ${table} read failed: ${error.message}`);
  return (data ?? []) as { payload: unknown }[];
}

export async function readCandidatesByChainAddresses(chain: string, addresses: string[]): Promise<{ payload: unknown }[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const normalized = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 30);
  if (!normalized.length) return [];
  const { data, error } = await supabase.from("radar_candidates").select("payload").eq("chain", chain).in("token_address", normalized).limit(30);
  if (error) throw new Error(`Supabase candidate lookup failed: ${error.message}`);
  return (data ?? []) as { payload: unknown }[];
}

export async function readSecurityReports(limit = 500): Promise<{ report: unknown }[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("radar_security_reports").select("report").order("checked_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Supabase security report read failed: ${error.message}`);
  return (data ?? []) as { report: unknown }[];
}

export async function readLastSuccessfulSync(source: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("radar_sync_state").select("last_successful_at").eq("source", source).maybeSingle();
  if (error) throw new Error(`Supabase sync-state read failed: ${error.message}`);
  const value = (data as { last_successful_at?: string | null } | null)?.last_successful_at;
  return normalizeDatabaseTimestamp(value);
}

export async function upsertCandidate(row: { id: string; chain: string; token_address?: string | null; payload: TokenCandidate }): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const candidate = row.payload;
  const address = row.token_address ?? candidate.address ?? null;
  const id = address ? `${row.chain}:${address.toLowerCase()}` : row.id;
  const { error } = await supabase.from("radar_candidates").upsert({
    id, chain: row.chain, token_address: address?.toLowerCase() ?? null, name: candidate.name, symbol: candidate.symbol,
    market_metrics: candidate.metrics, payload: candidate, created_at: candidate.discoveredAt, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Supabase candidate write failed: ${error.message}`);
}

export async function upsertSecurityReport(report: SecurityReport): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const ttl = Number(process.env.SECURITY_TTL_SECONDS) > 0 ? Number(process.env.SECURITY_TTL_SECONDS) : 900;
  const checkedAt = Date.parse(report.checkedAt);
  const expiresAt = Number.isFinite(checkedAt) ? new Date(checkedAt + ttl * 1000).toISOString() : null;
  const { error } = await supabase.from("radar_security_reports").upsert({
    chain: report.chain, token_address: report.address.toLowerCase(), provider: report.provider,
    verdict: report.verdict ?? "UNKNOWN", risk_flags: report.flags, evidence: report.checks,
    assessed_at: report.checkedAt, expires_at: expiresAt, report, checked_at: report.checkedAt,
  }, { onConflict: "chain,token_address,provider" });
  if (error) throw new Error(`Supabase security report write failed: ${error.message}`);
}

function postKey(post: SocialPost): string {
  return post.externalId ? `x:${post.externalId}` : post.sourceUrl ? `url:${post.sourceUrl}` : `text:${(post.author ?? "").toLowerCase()}|${post.publishedAt ?? ""}|${post.text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}
function dedupePosts<T extends { sourcePosts: SocialPost[] }>(record: T): T {
  const unique = new Map<string, SocialPost>();
  for (const post of record.sourcePosts) {
    const key = postKey(post);
    const existing = unique.get(key);
    unique.set(key, existing ? mergeSocialPosts(existing, post) : post);
  }
  return { ...record, sourcePosts: [...unique.values()] };
}
function sourceUrls(posts: SocialPost[]): string[] { return [...new Set(posts.map((post) => post.sourceUrl).filter((url): url is string => Boolean(url)))]; }

export async function persistIngestion(envelope: IngestionEnvelope): Promise<{ accepted: true; duplicate: boolean; counts: Record<string, number> }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: existing, error: existingError } = await supabase.from("radar_ingestion_events").select("event_id").eq("event_id", envelope.eventId).maybeSingle();
  if (existingError) throw new Error(`Supabase idempotency check failed: ${existingError.message}`);
  if (existing) return { accepted: true, duplicate: true, counts: { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } };

  const nfts: NftOpportunity[] = envelope.nfts.map((row) => normalizeNftOpportunity(dedupePosts({ ...row, contractVerified: null, securityStatus: "pending", lastVerifiedAt: undefined })));
  const gtd: GtdOpportunity[] = envelope.gtd.map((row) => normalizeGtdOpportunity(dedupePosts(row)));
  let tokens: TokenCandidate[] = envelope.tokens.map((row) => normalizeCtoCandidate(dedupePosts({ ...row, metrics: {} })));
  const candidateId = (row: TokenCandidate) => row.address ? `${row.chain}:${row.address.toLowerCase()}` : row.id;
  if (tokens.length) {
    const { data: storedRows, error: candidateReadError } = await supabase.from("radar_candidates").select("id,payload").in("id", tokens.map(candidateId));
    if (candidateReadError) throw new Error(`Supabase candidate history read failed: ${candidateReadError.message}`);
    const storedById = new Map<string, TokenCandidate>();
    for (const row of storedRows ?? []) {
      const parsed = TokenCandidateSchema.safeParse(row.payload);
      if (parsed.success) storedById.set(String(row.id), parsed.data);
    }
    tokens = tokens.map((incoming) => {
      const existing = storedById.get(candidateId(incoming));
      return existing ? mergeTokenCandidateHistory(existing, incoming) : incoming;
    });
  }
  let narratives: Narrative[] = envelope.narratives.map((row) => normalizeNarrative(dedupePosts(row)));
  if (narratives.length) {
    const { data: storedRows, error: narrativeReadError } = await supabase
      .from("radar_narratives")
      .select("id,payload")
      .in("id", narratives.map((row) => row.id));
    if (narrativeReadError) throw new Error(`Supabase narrative history read failed: ${narrativeReadError.message}`);
    const storedById = new Map<string, Narrative>();
    for (const row of storedRows ?? []) {
      const parsed = NarrativeSchema.safeParse(row.payload);
      if (parsed.success) storedById.set(String(row.id), parsed.data);
    }
    narratives = narratives.map((incoming) => {
      const existing = storedById.get(incoming.id);
      return existing ? mergeNarrativeHistory(existing, incoming) : incoming;
    });
  }
  const updatedAt = new Date().toISOString();
  const nftRows = nfts.map((payload) => ({ id: payload.id, collection_name: payload.name, chain: payload.chain, collection_address: payload.contractAddress ?? null, mint_address: payload.mintContractAddress ?? null, mint_type: payload.kind, mint_price_usd: payload.mintPriceUsd ?? null, mint_start: payload.mintAt ?? null, mint_end: payload.mintEndsAt ?? null, eligibility: payload.eligibility ?? null, verification_status: payload.securityStatus, source_urls: sourceUrls(payload.sourcePosts), security_status: payload.securityStatus, payload, updated_at: updatedAt }));
  const gtdRows = gtd.map((payload) => ({ id: payload.id, project_name: payload.name, chain: payload.chain, mint_at: payload.mintAt ?? null, status: payload.status, mint_price_usd: payload.mintPriceUsd ?? null, allocation: payload.allocation ?? null, eligibility: payload.eligibility ?? null, source_urls: [...new Set([...sourceUrls(payload.sourcePosts), ...(payload.officialEvidenceUrl ? [payload.officialEvidenceUrl] : [])])], payload, updated_at: updatedAt }));
  const candidateRows = tokens.map((payload) => ({ id: payload.address ? `${payload.chain}:${payload.address.toLowerCase()}` : payload.id, chain: payload.chain, token_address: payload.address?.toLowerCase() ?? null, name: payload.name, symbol: payload.symbol, market_metrics: payload.metrics, payload, created_at: payload.discoveredAt, updated_at: updatedAt }));
  const narrativeRows = narratives.map((payload) => ({ id: payload.id, name: payload.category, keywords: payload.keywords ?? [], mention_metrics: { mentionCount: payload.mentionCount, uniqueAuthors: payload.uniqueAuthors, engagement: payload.engagement, growthPct: payload.growthPct, contractMentionCount: payload.contractMentionCount, discoveredTokenCount: payload.discoveredTokenCount, independentSupportingAccounts: payload.independentSupportingAccounts, securityPassRatio: payload.securityPassRatio, timeSeries: payload.timeSeries ?? [] }, momentum_score: payload.accelerationScore, first_seen_at: payload.sourcePosts.map((post) => post.publishedAt).filter(Boolean).sort()[0] ?? payload.lastUpdatedAt, updated_at: updatedAt, payload }));
  const incomingPostKeys = new Set([...envelope.nfts, ...envelope.gtd, ...envelope.tokens, ...envelope.narratives].flatMap((row) => row.sourcePosts).map(postKey));
  const allPosts = [...nfts.flatMap((row) => row.sourcePosts), ...gtd.flatMap((row) => row.sourcePosts), ...tokens.flatMap((row) => row.sourcePosts), ...narratives.flatMap((row) => row.sourcePosts)].filter((post) => incomingPostKeys.has(postKey(post)));
  const posts = buildSocialPostRows(allPosts, updatedAt);
  const ctoRows = tokens.filter((token) => token.ctoStatus !== "none").map((token) => ({ id: token.address ? `${token.chain}:${token.address.toLowerCase()}` : token.id, chain: token.chain, token_address: token.address?.toLowerCase() ?? null, classification: token.ctoStatus, confidence: token.ctoConfidence ?? null, evidence_urls: sourceUrls(token.sourcePosts), evidence_summary: token.ctoEvidence ?? null, assessed_at: updatedAt, evidence: { evidenceAccountCount: token.ctoEvidenceAccountCount ?? null, originalTeamAbandoned: token.originalTeamAbandoned ?? null, originalAccountStatement: token.originalAccountStatement ?? null, communityAccount: token.communityAccount ?? null, contradicted: token.ctoContradicted ?? null, impersonationRisk: token.impersonationRisk ?? null } }));
  const batches: Array<{ table: string; rows: Record<string, unknown>[] }> = [
    { table: "radar_nfts", rows: nftRows }, { table: "radar_gtd", rows: gtdRows }, { table: "radar_candidates", rows: candidateRows },
    { table: "radar_narratives", rows: narrativeRows }, { table: "radar_social_posts", rows: posts }, { table: "radar_cto_evidence", rows: ctoRows },
  ];
  const conflictByTable: Record<string, string> = { radar_nfts: "id", radar_gtd: "id", radar_candidates: "id", radar_narratives: "id", radar_social_posts: "id", radar_cto_evidence: "id" };
  for (const batch of batches) {
    if (!batch.rows.length) continue;
    const { error } = await supabase.from(batch.table).upsert(batch.rows, { onConflict: conflictByTable[batch.table] });
    if (error) throw new Error(`Supabase ${batch.table} write failed: ${error.message}`);
  }
  const { error: syncError } = await supabase.from("radar_sync_state").upsert({ source: "agent-reach", last_successful_at: envelope.syncedAt, details: { eventId: envelope.eventId, records: { nfts: nfts.length, gtd: gtd.length, tokens: tokens.length, narratives: narratives.length } } }, { onConflict: "source" });
  if (syncError) throw new Error(`Supabase sync state write failed: ${syncError.message}`);
  const { error: eventError } = await supabase.from("radar_ingestion_events").upsert({ event_id: envelope.eventId, source: envelope.source, ingested_at: updatedAt }, { onConflict: "event_id", ignoreDuplicates: true });
  if (eventError) throw new Error(`Supabase idempotency marker write failed: ${eventError.message}`);
  return { accepted: true, duplicate: false, counts: { nfts: nfts.length, gtd: gtd.length, tokens: tokens.length, narratives: narratives.length, socialPosts: posts.length } };
}
