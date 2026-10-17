import { describe, expect, it } from "vitest";
import { AUTO_REFRESH_MS, DASHBOARD_TIMEOUT_MS, hasDashboardRecords } from "./dashboard-refresh";
import { getDemoDashboard } from "./demo";

describe("dashboard refresh", () => {
  it("checks every ten minutes with a bounded request timeout", () => {
    expect(AUTO_REFRESH_MS).toBe(600_000);
    expect(DASHBOARD_TIMEOUT_MS).toBe(60_000);
  });
  it("recognizes initial empty data and all historical snapshot collections", () => {
    const payload = getDemoDashboard();
    const keys = ["nfts", "gtd", "tokens", "ctoClaims", "securityQueue", "securityReports", "providerReports", "narratives", "socialReviewQueue", "recentExclusions"] as const;
    for (const key of keys) payload[key] = [];
    expect(hasDashboardRecords(payload)).toBe(false);
    for (const key of keys) {
      const withRecord = { ...payload, [key]: [{}] };
      expect(hasDashboardRecords(withRecord as typeof payload), key).toBe(true);
    }
  });
});
