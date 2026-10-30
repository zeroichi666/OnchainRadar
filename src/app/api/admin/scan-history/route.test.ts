import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase", () => ({
  clearScanHistory: vi.fn(),
  getStorageStatus: vi.fn(),
}));

import { DELETE } from "./route";
import { clearScanHistory, getStorageStatus } from "@/lib/server/supabase";
import { SCAN_HISTORY_CONFIRMATION } from "@/lib/scan-history";
import { clearRateLimitsForTests } from "@/lib/server/rate-limit";

const validSecret = "test-only-secret-with-at-least-32-characters";
let ipCounter = 0;

function makeRequest(options: { secret?: string; origin?: string; body?: unknown; contentType?: string } = {}) {
  const headers = new Headers({ "content-type": options.contentType ?? "application/json", "x-forwarded-for": `192.0.2.${++ipCounter}` });
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.secret !== undefined) headers.set("authorization", `Bearer ${options.secret}`);
  return new Request("https://radar.example/api/admin/scan-history", {
    method: "DELETE",
    headers,
    body: JSON.stringify(options.body ?? { confirmation: SCAN_HISTORY_CONFIRMATION }),
  });
}

function authorizedRequest(options: { origin?: string; secret?: string; body?: unknown } = {}) {
  return makeRequest({ origin: options.origin ?? "https://radar.example", secret: options.secret ?? validSecret, body: options.body });
}

describe("DELETE /api/admin/scan-history", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    clearRateLimitsForTests();
    vi.stubEnv("SCAN_HISTORY_DELETE_SECRET", validSecret);
    vi.stubEnv("APP_ORIGIN", "https://radar.example");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_PRIME_URL", "");
    vi.stubEnv("ALLOWED_INGEST_ORIGINS", "");
    vi.mocked(getStorageStatus).mockReturnValue({ provider: "sqlite", configured: true, detail: "SQLite ready." });
    vi.mocked(clearScanHistory).mockResolvedValue({
      records: { radar_candidates: 2, radar_nfts: 0, radar_gtd: 0, radar_narratives: 0, radar_social_posts: 0, radar_cto_evidence: 0, radar_security_reports: 1 },
      syncState: 1,
      ingestionEvents: 2,
    });
  });

  it("fails closed when the deletion secret or allowed origin is missing", async () => {
    vi.stubEnv("SCAN_HISTORY_DELETE_SECRET", "");
    const noSecret = await DELETE(authorizedRequest());
    expect(noSecret.status).toBe(503);

    vi.stubEnv("SCAN_HISTORY_DELETE_SECRET", validSecret);
    vi.stubEnv("APP_ORIGIN", "");
    const noOriginConfiguration = await DELETE(authorizedRequest());
    expect(noOriginConfiguration.status).toBe(503);
    expect(clearScanHistory).not.toHaveBeenCalled();
  });

  it("rejects missing/disallowed origins and invalid bearer credentials", async () => {
    expect((await DELETE(makeRequest({ secret: validSecret }))).status).toBe(403);
    expect((await DELETE(authorizedRequest({ origin: "https://attacker.example" }))).status).toBe(403);
    expect((await DELETE(authorizedRequest({ secret: "incorrect-secret" }))).status).toBe(401);
    expect(clearScanHistory).not.toHaveBeenCalled();
  });

  it("requires the explicit confirmation phrase and configured storage", async () => {
    expect((await DELETE(authorizedRequest({ body: { confirmation: "yes" } }))).status).toBe(422);
    vi.mocked(getStorageStatus).mockReturnValue({ provider: "supabase", configured: false, detail: "Storage is not configured." });
    expect((await DELETE(authorizedRequest())).status).toBe(503);
    expect(clearScanHistory).not.toHaveBeenCalled();
  });

  it("clears the active provider only after every control passes and returns no-store counts", async () => {
    const response = await DELETE(authorizedRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ cleared: true, provider: "sqlite", syncState: 1, ingestionEvents: 2 });
    expect(clearScanHistory).toHaveBeenCalledOnce();
  });
});
