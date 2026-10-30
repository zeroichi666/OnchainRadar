import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NarrativeSchema, TokenCandidateSchema } from "@/lib/domain";
import type { GtdOpportunity, Narrative, NftOpportunity, SecurityReport, SocialPost, TokenCandidate } from "@/lib/domain";
import { normalizeCtoCandidate, normalizeGtdOpportunity, normalizeNarrative, normalizeNftOpportunity } from "@/lib/classification";
import type { IngestionEnvelope } from "@/lib/server/ingest-schema";
import { normalizeDatabaseTimestamp } from "@/lib/server/timestamps";
import { buildSocialPostRows, mergeNarrativeHistory, mergeTokenCandidateHistory } from "@/lib/server/social-persistence";
import { mergeSocialPosts } from "@/lib/social-review";
import {
  clearSqliteScanHistory,
  commitSqliteIngestionIfNew,
  getSqliteDatabase,
  getSqliteDatabasePath,
  isSqliteIngestionEventRecorded,
  readSqliteCandidatesByChainAddresses,
  readSqliteLastSuccessfulSync,
  readSqlitePayloadRowsByIds,
  readSqlitePayloadTable,
  readSqliteSecurityReports,
  type ScanHistoryClearResult,
  upsertSqliteRecord,
  writeSqliteSyncState,
} from "@/lib/server/sqlite-storage";

export type StorageProvider = "supabase" | "sqlite";
export type StorageStatus = {
  provider: StorageProvider | "unknown";
  configured: boolean;
  detail: string;
};

let client: SupabaseClient | null | undefined;
export function getSupabaseServerClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) { client = null; return client; }
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

export function getStorageProvider(): StorageProvider {
  const selected = process.env.STORAGE_PROVIDER?.trim().toLowerCase() || "supabase";
  if (selected === "supabase" || selected === "sqlite") return selected;
  throw new Error("STORAGE_PROVIDER must be either supabase or sqlite.");
}

export function getStorageStatus(): StorageStatus {
  const configuredValue = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (configuredValue && configuredValue !== "supabase" && configuredValue !== "sqlite") {
    return { provider: "unknown", configured: false, detail: "STORAGE_PROVIDER must be either supabase or sqlite." };
  }
  const provider = (configuredValue || "supabase") as StorageProvider;
  if (process.env.DATA_MODE !== "live") {
    return { provider, configured: false, detail: "Set DATA_MODE=live to enable persistent storage; demo mode does not write records." };
  }
  if (provider === "sqlite") {
    try {
      getSqliteDatabase();
      return { provider, configured: true, detail: `Local SQLite storage is ready (${getSqliteDatabasePath() === ":memory:" ? "in-memory test database" : "database file"}).` };
    } catch {
      return { provider, configured: false, detail: "Local SQLite storage could not be opened. Check the Node.js version, SQLITE_DATABASE_PATH, and file permissions." };
    }
  }
  const supabase = getSupabaseServerClient();
  return supabase
    ? { provider, configured: true, detail: "Supabase server client is configured; database health is checked on read/write." }
    : { provider, configured: false, detail: "Supabase server credentials are missing." };
}

export function isStorageConfigured(): boolean {
  return getStorageStatus().configured;
}

export async function clearScanHistory(): Promise<ScanHistoryClearResult> {
  if (process.env.DATA_MODE !== "live") throw new Error("Scan history deletion requires DATA_MODE=live.");
  if (getStorageProvider() === "sqlite") return clearSqliteScanHistory();

  const { data, error } = await requireSupabase().rpc("clear_scan_history");
  if (error) throw new Error(`Supabase scan history clear failed: ${error.message}`);
  if (!data || typeof data !== "object" || !("records" in data)) {
    throw new Error("Supabase scan history clear returned an invalid result.");
  }
  return data as ScanHistoryClearResult;
}

function requireSupabase(): SupabaseClient {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function readPayloadTable(table: "radar_candidates" | "radar_nfts" | "radar_gtd" | "radar_narratives", limit = 100): Promise<{ payload: unknown }[]> {
  if (getStorageProvider() === "sqlite") return readSqlitePayloadTable(table, limit);
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select("payload").order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Supabase ${table} read failed: ${error.message}`);
  return (data ?? []) as { payload: unknown }[];
}

export async function readPayloadRowsByIds(
  table: "radar_candidates" | "radar_narratives",
  ids: string[],
): Promise<{ id: string; payload: unknown }[]> {
  const normalized = [...new Set(ids)].slice(0, 500);
  if (!normalized.length) return [];
  if (getStorageProvider() === "sqlite") return readSqlitePayloadRowsByIds(table, normalized);
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select("id,payload").in("id", normalized);
  if (error) throw new Error(`Supabase ${table} history read failed: ${error.message}`);
  return (data ?? []) as { id: string; payload: unknown }[];
}

export async function readCandidatesByChainAddresses(chain: string, addresses: string[]): Promise<{ payload: unknown }[]> {
  if (getStorageProvider() === "sqlite") return readSqliteCandidatesByChainAddresses(chain, addresses);
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const normalized = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 30);
  if (!normalized.length) return [];
  const { data, error } = await supabase.from("radar_candidates").select("payload").eq("chain", chain).in("token_address", normalized).limit(30);
  if (error) throw new Error(`Supabase candidate lookup failed: ${error.message}`);
  return (data ?? []) as { payload: unknown }[];
}

export async function readSecurityReports(limit = 500): Promise<{ report: unknown }[]> {
  if (getStorageProvider() === "sqlite") return readSqliteSecurityReports(limit);
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("radar_security_reports").select("report").order("checked_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Supabase security report read failed: ${error.message}`);
  return (data ?? []) as { report: unknown }[];
}

export async function readLastSuccessfulSync(source: string): Promise<string | null> {
  if (getStorageProvider() === "sqlite") return normalizeDatabaseTimestamp(readSqliteLastSuccessfulSync(source));
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("radar_sync_state").select("last_successful_at").eq("source", source).maybeSingle();
  if (error) throw new Error(`Supabase sync-state read failed: ${error.message}`);
  const value = (data as { last_successful_at?: string | null } | null)?.last_successful_at;
  return normalizeDatabaseTimestamp(value);
}

export async function upsertSyncState(source: string, lastSuccessfulAt: string, details: Record<string, unknown>): Promise<void> {
  if (getStorageProvider() === "sqlite") {
    writeSqliteSyncState(source, lastSuccessfulAt, details);
    return;
  }
  const { error } = await requireSupabase().from("radar_sync_state").upsert(
    { source, last_successful_at: lastSuccessfulAt, details },
    { onConflict: "source" },
  );
  if (error) throw new Error(`Supabase sync-state write failed: ${error.message}`);
}

export async function upsertCandidate(row: { id: string; chain: string; token_address?: string | null; payload: TokenCandidate }): Promise<void> {
  const candidate = row.payload;
  const address = row.token_address ?? candidate.address ?? null;
  const id = address ? `${row.chain}:${address.toLowerCase()}` : row.id;
  if (getStorageProvider() === "sqlite") {
    upsertSqliteRecord("radar_candidates", {
      id,
      chain: row.chain,
      token_address: address?.toLowerCase() ?? null,
      updated_at: new Date().toISOString(),
      payload: candidate,
    });
    return;
  }
  const { error } = await requireSupabase().from("radar_candidates").upsert({
    id, chain: row.chain, token_address: address?.toLowerCase() ?? null, name: candidate.name, symbol: candidate.symbol,
    market_metrics: candidate.metrics, payload: candidate, created_at: candidate.discoveredAt, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Supabase candidate write failed: ${error.message}`);
}

export async function upsertSecurityReport(report: SecurityReport): Promise<void> {
  const ttl = Number(process.env.SECURITY_TTL_SECONDS) > 0 ? Number(process.env.SECURITY_TTL_SECONDS) : 900;
  const checkedAt = Date.parse(report.checkedAt);
  const expiresAt = Number.isFinite(checkedAt) ? new Date(checkedAt + ttl * 1000).toISOString() : null;
  if (getStorageProvider() === "sqlite") {
    upsertSqliteRecord("radar_security_reports", {
      id: `${report.chain}:${report.address.toLowerCase()}:${report.provider}`,
      chain: report.chain,
      token_address: report.address.toLowerCase(),
      updated_at: report.checkedAt,
      payload: report,
    });
    return;
  }
  const { error } = await requireSupabase().from("radar_security_reports").upsert({
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
  if (process.env.DATA_MODE !== "live") throw new Error("Persistent ingestion requires DATA_MODE=live.");
  const provider = getStorageProvider();
  const supabase = provider === "supabase" ? getSupabaseServerClient() : null;
  if (provider === "supabase" && !supabase) throw new Error("Supabase is not configured");
  if (provider === "sqlite" && !getStorageStatus().configured) throw new Error("SQLite storage is not configured");

  if (provider === "sqlite") {
    if (isSqliteIngestionEventRecorded(envelope.eventId)) {
      return { accepted: true, duplicate: true, counts: { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } };
    }
  } else {
    const { data: existing, error: existingError } = await supabase!.from("radar_ingestion_events").select("event_id").eq("event_id", envelope.eventId).maybeSingle();
    if (existingError) throw new Error(`Supabase idempotency check failed: ${existingError.message}`);
    if (existing) return { accepted: true, duplicate: true, counts: { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } };
  }

  const nfts: NftOpportunity[] = envelope.nfts.map((row) => normalizeNftOpportunity(dedupePosts({ ...row, contractVerified: null, securityStatus: "pending", lastVerifiedAt: undefined })));
  const gtd: GtdOpportunity[] = envelope.gtd.map((row) => normalizeGtdOpportunity(dedupePosts(row)));
  let tokens: TokenCandidate[] = envelope.tokens.map((row) => normalizeCtoCandidate(dedupePosts({ ...row, metrics: {} })));
  const candidateId = (row: TokenCandidate) => row.address ? `${row.chain}:${row.address.toLowerCase()}` : row.id;
  if (tokens.length) {
    const storedRows = provider === "sqlite"
      ? readSqlitePayloadRowsByIds("radar_candidates", tokens.map(candidateId))
      : await (async () => {
          const { data, error } = await supabase!.from("radar_candidates").select("id,payload").in("id", tokens.map(candidateId));
          if (error) throw new Error(`Supabase candidate history read failed: ${error.message}`);
          return (data ?? []) as { id: string; payload: unknown }[];
        })();
    const storedById = new Map<string, TokenCandidate>();
    for (const row of storedRows) {
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
    const storedRows = provider === "sqlite"
      ? readSqlitePayloadRowsByIds("radar_narratives", narratives.map((row) => row.id))
      : await (async () => {
          const { data, error } = await supabase!.from("radar_narratives").select("id,payload").in("id", narratives.map((row) => row.id));
          if (error) throw new Error(`Supabase narrative history read failed: ${error.message}`);
          return (data ?? []) as { id: string; payload: unknown }[];
        })();
    const storedById = new Map<string, Narrative>();
    for (const row of storedRows) {
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
  const batches: Array<{ table: "radar_nfts" | "radar_gtd" | "radar_candidates" | "radar_narratives" | "radar_social_posts" | "radar_cto_evidence"; rows: Record<string, unknown>[] }> = [
    { table: "radar_nfts", rows: nftRows }, { table: "radar_gtd", rows: gtdRows }, { table: "radar_candidates", rows: candidateRows },
    { table: "radar_narratives", rows: narrativeRows }, { table: "radar_social_posts", rows: posts }, { table: "radar_cto_evidence", rows: ctoRows },
  ];
  const counts = { nfts: nfts.length, gtd: gtd.length, tokens: tokens.length, narratives: narratives.length, socialPosts: posts.length };

  if (provider === "sqlite") {
    const committed = commitSqliteIngestionIfNew({
      eventId: envelope.eventId,
      source: envelope.source,
      ingestedAt: updatedAt,
      syncedAt: envelope.syncedAt,
      syncDetails: { eventId: envelope.eventId, records: { nfts: counts.nfts, gtd: counts.gtd, tokens: counts.tokens, narratives: counts.narratives } },
      batches,
    });
    return { accepted: true, duplicate: !committed, counts: committed ? counts : { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } };
  }

  const conflictByTable: Record<string, string> = { radar_nfts: "id", radar_gtd: "id", radar_candidates: "id", radar_narratives: "id", radar_social_posts: "id", radar_cto_evidence: "id" };
  for (const batch of batches) {
    if (!batch.rows.length) continue;
    const { error } = await supabase!.from(batch.table).upsert(batch.rows, { onConflict: conflictByTable[batch.table] });
    if (error) throw new Error(`Supabase ${batch.table} write failed: ${error.message}`);
  }
  const { error: syncError } = await supabase!.from("radar_sync_state").upsert({ source: "agent-reach", last_successful_at: envelope.syncedAt, details: { eventId: envelope.eventId, records: { nfts: nfts.length, gtd: gtd.length, tokens: tokens.length, narratives: narratives.length } } }, { onConflict: "source" });
  if (syncError) throw new Error(`Supabase sync state write failed: ${syncError.message}`);
  const { error: eventError } = await supabase!.from("radar_ingestion_events").upsert({ event_id: envelope.eventId, source: envelope.source, ingested_at: updatedAt }, { onConflict: "event_id", ignoreDuplicates: true });
  if (eventError) throw new Error(`Supabase idempotency marker write failed: ${eventError.message}`);
  return { accepted: true, duplicate: false, counts };
}
