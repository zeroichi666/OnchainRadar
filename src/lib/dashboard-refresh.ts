import type { DashboardPayload } from "@/lib/domain";

export const AUTO_REFRESH_MS = 10 * 60 * 1000;
export const DASHBOARD_TIMEOUT_MS = 60 * 1000;

export function hasDashboardRecords(payload: DashboardPayload): boolean {
  return [payload.nfts, payload.gtd, payload.tokens, payload.ctoClaims, payload.securityQueue,
    payload.securityReports, payload.providerReports, payload.narratives, payload.socialReviewQueue,
    payload.recentExclusions].some((rows) => rows.length > 0);
}
