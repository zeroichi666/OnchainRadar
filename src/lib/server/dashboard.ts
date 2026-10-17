import "server-only";
import {
  DashboardPayloadSchema, GtdOpportunitySchema, NarrativeSchema, NftOpportunitySchema,
  SecurityReportSchema, TokenCandidateSchema, type DashboardPayload, type SecurityReport,
  type TokenCandidate,
} from "@/lib/domain";
import { getDemoDashboard } from "@/lib/demo";
import { normalizeCtoCandidate, normalizeGtdOpportunity, normalizeNarrative, normalizeNftOpportunity } from "@/lib/classification";
import { buildSocialReviewQueue } from "@/lib/social-review";
import { consolidateSecurityReports, defaultSettings, evaluateSecurityGate, isSecurityReportStale } from "@/lib/security";
import type { RadarClientSettings } from "@/lib/settings";
import { enrichCandidateBatch } from "@/lib/server/dexscreener";
import { fetchGoPlusSecurity } from "@/lib/server/goplus";
import { fetchSolanaSecurity } from "@/lib/server/solana-security";
import { getSupabaseServerClient, readLastSuccessfulSync, readPayloadTable, readSecurityReports, upsertCandidate, upsertSecurityReport } from "@/lib/server/supabase";

const nowIso = () => new Date().toISOString();
const reportKey = (report: SecurityReport) => `${report.chain}:${report.address.toLowerCase()}`;

function parseRows<T>(rows: { payload: unknown }[], schema: { safeParse(value: unknown): { success: boolean; data?: T } }, label: string, warnings: string[]): T[] {
  const result: T[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row.payload);
    if (parsed.success && parsed.data !== undefined) result.push(parsed.data);
    else warnings.push(`Ignored one invalid ${label} record from Supabase.`);
  }
  return result;
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

export async function getDashboardPayload(clientSettings?: RadarClientSettings): Promise<DashboardPayload> {
  if (process.env.DATA_MODE !== "live") return DashboardPayloadSchema.parse(getDemoDashboard());
  const warnings: string[] = [];
  const empty = {
    mode: "live" as const, generatedAt: nowIso(), lastSuccessfulSocialSyncAt: null, warnings,
    nfts: [], gtd: [], tokens: [], ctoClaims: [], securityQueue: [], securityReports: [], providerReports: [], narratives: [], socialReviewQueue: [], recentExclusions: [],
  };
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    warnings.push("Live mode is enabled, but Supabase server credentials are missing. No demo data is shown in live mode.");
    warnings.push("Configure the protected Agent-Reach worker and server-side provider settings to populate the dashboard.");
    return DashboardPayloadSchema.parse(empty);
  }

  let nftRows: { payload: unknown }[] = [];
  let gtdRows: { payload: unknown }[] = [];
  let candidateRows: { payload: unknown }[] = [];
  let narrativeRows: { payload: unknown }[] = [];
  let reportRows: { report: unknown }[] = [];
  let lastSuccessfulSocialSyncAt: string | null = null;
  try {
    [nftRows, gtdRows, candidateRows, narrativeRows, reportRows, lastSuccessfulSocialSyncAt] = await Promise.all([
      readPayloadTable("radar_nfts", 200), readPayloadTable("radar_gtd", 200), readPayloadTable("radar_candidates", 100),
      readPayloadTable("radar_narratives", 100), readSecurityReports(500), readLastSuccessfulSync("agent-reach"),
    ]);
  } catch {
    // A failed read is not an empty dataset. Let APIs return a retryable failure
    // so refreshing clients can keep their last successful snapshot.
    throw new Error("Supabase dashboard data could not be read.");
  }
  if (!process.env.INGESTION_SECRET) warnings.push("INGESTION_SECRET is not configured; the worker cannot submit protected live data.");
  if (!lastSuccessfulSocialSyncAt) warnings.push("No successful Agent-Reach/X synchronization has been recorded yet.");
  else if (Date.now() - Date.parse(lastSuccessfulSocialSyncAt) > 6 * 60 * 60 * 1000) warnings.push(`Social data is stale; the last successful synchronization was ${lastSuccessfulSocialSyncAt}.`);

  const lowCostThreshold = clientSettings?.lowCostMintThresholdUsd ?? defaultSettings.lowCostMintThresholdUsd;
  const nfts = parseRows(nftRows, NftOpportunitySchema, "NFT", warnings).map((row) => normalizeNftOpportunity(row, Date.now(), lowCostThreshold));
  const gtd = parseRows(gtdRows, GtdOpportunitySchema, "GTD", warnings).map(normalizeGtdOpportunity);
  const candidates = parseRows(candidateRows, TokenCandidateSchema, "token candidate", warnings).map(normalizeCtoCandidate).slice(0, 100);
  const narratives = parseRows(narrativeRows, NarrativeSchema, "narrative", warnings).map(normalizeNarrative);
  const reports: SecurityReport[] = [];
  for (const row of reportRows) {
    const parsed = SecurityReportSchema.safeParse(row.report);
    if (parsed.success) reports.push(parsed.data);
    else warnings.push("Ignored one invalid security report from Supabase.");
  }
  const reportGroups = new Map<string, SecurityReport[]>();
  for (const report of reports) reportGroups.set(reportKey(report), [...(reportGroups.get(reportKey(report)) ?? []), report]);
  const currentReport = (candidate: TokenCandidate) => candidate.address ? consolidateSecurityReports(reportGroups.get(`${candidate.chain}:${candidate.address.toLowerCase()}`) ?? []) : undefined;

  let enriched = candidates;
  if (candidates.length) {
    const enrichment = await enrichCandidateBatch(candidates.slice(0, 30));
    enriched = [...enrichment.candidates, ...candidates.slice(30)];
    warnings.push(...enrichment.warnings);
    const refreshed = enrichment.candidates.filter((candidate) => JSON.stringify(candidate.metrics) !== JSON.stringify(candidates.find((row) => row.id === candidate.id)?.metrics));
    await Promise.all(refreshed.map((candidate) => upsertCandidate({ id: candidate.id, chain: candidate.chain, token_address: candidate.address ?? null, payload: candidate }).catch(() => warnings.push("Market-data cache write failed for a candidate."))));
  }

  const ttl = Number(process.env.SECURITY_TTL_SECONDS) > 0 ? Number(process.env.SECURITY_TTL_SECONDS) : defaultSettings.securityTtlSeconds;
  const staleCandidates = enriched.filter((candidate) => {
    if (!candidate.address) return false;
    const current = currentReport(candidate);
    return !current || isSecurityReportStale(current, ttl);
  }).slice(0, 10);
  await mapLimit(staleCandidates, 4, async (candidate) => {
    if (!candidate.address) return null;
    const report = candidate.chain === "solana"
      ? await fetchSolanaSecurity(candidate.address)
      : await fetchGoPlusSecurity(candidate.chain, candidate.address);
    const key = reportKey(report);
    reportGroups.set(key, [...(reportGroups.get(key) ?? []).filter((stored) => stored.provider !== report.provider), report]);
    try { await upsertSecurityReport(report); } catch { warnings.push("Security report cache write failed; current result remains in memory only."); }
    return report;
  });
  const providerReports = [...reportGroups.values()].flat();
  const securityReports = [...reportGroups.values()].map((group) => consolidateSecurityReports(group)).filter((report): report is SecurityReport => Boolean(report));
  if (securityReports.some((report) => report.verdict === "UNKNOWN")) warnings.push("One or more provider checks are incomplete or unavailable; those tokens remain outside the primary feed.");

  const settings = {
    ...defaultSettings,
    securityTtlSeconds: ttl,
    minimumLiquidityUsd: Number(process.env.MIN_LIQUIDITY_USD) > 0 ? Number(process.env.MIN_LIQUIDITY_USD) : defaultSettings.minimumLiquidityUsd,
    ...clientSettings,
    filters: { ...defaultSettings.filters, ...clientSettings?.filters },
  };
  const tokens: TokenCandidate[] = [];
  const ctoClaims: DashboardPayload["ctoClaims"] = [];
  const securityQueue: DashboardPayload["securityQueue"] = [];
  const recentExclusions: DashboardPayload["recentExclusions"] = [];
  for (const candidate of enriched) {
    const report = currentReport(candidate);
    const gate = evaluateSecurityGate(candidate, report, settings);
    if (gate.eligible) {
      tokens.push(candidate);
      if (candidate.ctoStatus !== "none" && candidate.ctoStatus !== "verified" && candidate.ctoStatus !== "probable") ctoClaims.push({ token: candidate, verdict: gate.verdict, reasons: ["The CTO claim is not verified as a confirmed takeover."] });
      continue;
    }
    if (candidate.ctoStatus !== "none") ctoClaims.push({ token: candidate, verdict: gate.verdict, reasons: gate.reasons.length ? gate.reasons : ["This CTO claim is not eligible for the confirmed module until its security review passes."] });
    const providerConflict = gate.reasons.some((reason) => reason.startsWith("Conflicting provider results:"));
    const incompleteScreening = gate.reasons.some((reason) => /unavailable|incomplete|pending|stale|invalid|missing|conflict/i.test(reason));
    if (gate.verdict === "PENDING" || gate.verdict === "UNKNOWN" || gate.verdict === "STALE" || incompleteScreening || providerConflict) {
      securityQueue.push({ token: candidate, verdict: providerConflict ? gate.verdict : incompleteScreening && gate.verdict !== "PENDING" && gate.verdict !== "STALE" ? "UNKNOWN" : gate.verdict, reasons: gate.reasons });
      if (providerConflict && gate.verdict === "FAIL") recentExclusions.push({ label: `${candidate.name} (${candidate.symbol})`, reason: gate.reasons.join("; "), at: report?.checkedAt ?? nowIso() });
    } else {
      recentExclusions.push({ label: `${candidate.name} (${candidate.symbol})`, reason: gate.reasons.join("; ") || "Security policy excluded the token", at: report?.checkedAt ?? nowIso() });
    }
  }
  return DashboardPayloadSchema.parse({
    mode: "live", generatedAt: nowIso(), lastSuccessfulSocialSyncAt, warnings,
    nfts, gtd, tokens, ctoClaims, securityQueue, securityReports, providerReports, narratives, socialReviewQueue: buildSocialReviewQueue(narratives),
    recentExclusions: recentExclusions.slice(0, 20),
  });
}
