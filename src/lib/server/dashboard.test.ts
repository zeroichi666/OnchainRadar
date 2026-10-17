import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase", () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
  readPayloadTable: vi.fn(async () => []),
  readSecurityReports: vi.fn(async () => []),
  readLastSuccessfulSync: vi.fn(async () => null),
  upsertCandidate: vi.fn(), upsertSecurityReport: vi.fn(),
}));
import { getDashboardPayload } from "./dashboard";
import { readPayloadTable } from "./supabase";

describe("safe dashboard refresh reads", () => {
  beforeEach(() => { vi.stubEnv("DATA_MODE", "live"); vi.mocked(readPayloadTable).mockReset().mockResolvedValue([]); });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects a failed database read instead of publishing an empty successful snapshot", async () => {
    vi.mocked(readPayloadTable).mockRejectedValueOnce(new Error("private provider diagnostic"));
    await expect(getDashboardPayload()).rejects.toThrow("Supabase dashboard data could not be read.");
  });
  it("still permits a genuinely empty initial live dataset", async () => {
    const payload = await getDashboardPayload();
    expect(payload.mode).toBe("live");
    expect(payload.narratives).toEqual([]);
    expect(payload.tokens).toEqual([]);
    expect(payload.lastSuccessfulSocialSyncAt).toBeNull();
  });
});
