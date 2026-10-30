import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase", () => ({
  getStorageStatus: vi.fn(() => ({ provider: "supabase", configured: true, detail: "Storage ready." })),
  readPayloadTable: vi.fn(async () => []),
  readSecurityReports: vi.fn(async () => []),
  readLastSuccessfulSync: vi.fn(async () => null),
  upsertCandidate: vi.fn(), upsertSecurityReport: vi.fn(),
}));
import { getDashboardPayload } from "./dashboard";
import { getStorageStatus, readPayloadTable } from "./supabase";

describe("safe dashboard refresh reads", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_MODE", "live");
    vi.stubEnv("STORAGE_PROVIDER", "supabase");
    vi.mocked(getStorageStatus).mockReturnValue({ provider: "supabase", configured: true, detail: "Storage ready." });
    vi.mocked(readPayloadTable).mockReset().mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a failed storage read instead of publishing an empty successful snapshot", async () => {
    vi.mocked(readPayloadTable).mockRejectedValueOnce(new Error("private provider diagnostic"));
    await expect(getDashboardPayload()).rejects.toThrow("Live dashboard data could not be read.");
  });

  it("still permits a genuinely empty initial live dataset", async () => {
    const payload = await getDashboardPayload();
    expect(payload.mode).toBe("live");
    expect(payload.narratives).toEqual([]);
    expect(payload.tokens).toEqual([]);
    expect(payload.lastSuccessfulSocialSyncAt).toBeNull();
  });

  it("keeps the live payload contract when local SQLite is selected", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "sqlite");
    vi.mocked(getStorageStatus).mockReturnValue({ provider: "sqlite", configured: true, detail: "Local SQLite storage is ready." });
    const payload = await getDashboardPayload();
    expect(payload.mode).toBe("live");
    expect(payload.warnings).toContain("INGESTION_SECRET is not configured; the worker cannot submit protected live data.");
  });

  it("does not silently substitute demo content when the selected backend is unavailable", async () => {
    vi.mocked(getStorageStatus).mockReturnValue({ provider: "sqlite", configured: false, detail: "Local SQLite could not be opened." });
    const payload = await getDashboardPayload();
    expect(payload.mode).toBe("live");
    expect(payload.warnings).toContain("Local SQLite could not be opened.");
    expect(payload.nfts).toEqual([]);
  });
});
