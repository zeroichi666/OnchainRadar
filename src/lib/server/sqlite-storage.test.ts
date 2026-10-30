import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { IngestionEnvelopeSchema } from "@/lib/server/ingest-schema";
import { getStorageStatus, persistIngestion, readCandidatesByChainAddresses, readLastSuccessfulSync, readPayloadRowsByIds, readPayloadTable, readSecurityReports } from "@/lib/server/supabase";
import { closeSqliteDatabase, commitSqliteIngestionIfNew, isSqliteIngestionEventRecorded, upsertSqliteRecord, writeSqliteSyncState } from "@/lib/server/sqlite-storage";

const syncedAt = "2026-10-30T00:00:00.000Z";

describe("local SQLite storage", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_MODE", "live");
    vi.stubEnv("STORAGE_PROVIDER", "sqlite");
    vi.stubEnv("SQLITE_DATABASE_PATH", ":memory:");
  });
  afterEach(() => {
    closeSqliteDatabase();
    vi.unstubAllEnvs();
  });

  it("opens as the selected live backend and persists candidate payloads for dashboard and refresh lookups", async () => {
    expect(getStorageStatus()).toMatchObject({ provider: "sqlite", configured: true });
    const candidate = {
      id: "base:0x1111111111111111111111111111111111111111",
      chain: "base",
      token_address: "0x1111111111111111111111111111111111111111",
      updated_at: syncedAt,
      payload: { id: "token-one", chain: "base", address: "0x1111111111111111111111111111111111111111" },
    };
    upsertSqliteRecord("radar_candidates", candidate);

    await expect(readPayloadTable("radar_candidates", 10)).resolves.toEqual([{ payload: candidate.payload }]);
    await expect(readPayloadRowsByIds("radar_candidates", [candidate.id])).resolves.toEqual([{ id: candidate.id, payload: candidate.payload }]);
    await expect(readCandidatesByChainAddresses("base", [candidate.token_address])).resolves.toEqual([{ payload: candidate.payload }]);
  });

  it("persists security reports and last successful sync state", async () => {
    const report = { chain: "base", address: "0x1111111111111111111111111111111111111111", provider: "test-provider", checkedAt: syncedAt, verdict: "UNKNOWN", flags: [], checks: [] };
    upsertSqliteRecord("radar_security_reports", {
      id: "base:0x1111111111111111111111111111111111111111:test-provider",
      chain: "base",
      token_address: report.address,
      updated_at: syncedAt,
      payload: report,
    });
    writeSqliteSyncState("agent-reach", syncedAt, { eventId: "sync-test-1" });

    await expect(readSecurityReports()).resolves.toEqual([{ report }]);
    await expect(readLastSuccessfulSync("agent-reach")).resolves.toBe(syncedAt);
  });

  it("commits ingestion once and treats a repeated eventId as a duplicate", async () => {
    const envelope = IngestionEnvelopeSchema.parse({
      schemaVersion: 1,
      eventId: "sqlite-event-001",
      source: "agent-reach",
      syncedAt,
      nfts: [],
      gtd: [],
      tokens: [],
      narratives: [],
    });

    await expect(persistIngestion(envelope)).resolves.toMatchObject({ accepted: true, duplicate: false, counts: { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } });
    await expect(persistIngestion(envelope)).resolves.toMatchObject({ accepted: true, duplicate: true, counts: { nfts: 0, gtd: 0, tokens: 0, narratives: 0, socialPosts: 0 } });
    expect(isSqliteIngestionEventRecorded(envelope.eventId)).toBe(true);
    await expect(readLastSuccessfulSync("agent-reach")).resolves.toBe(syncedAt);
  });

  it("rolls back records and event markers together if one row in the batch cannot be stored", async () => {
    expect(() => commitSqliteIngestionIfNew({
      eventId: "sqlite-event-rollback",
      source: "agent-reach",
      ingestedAt: syncedAt,
      syncedAt,
      syncDetails: {},
      batches: [
        { table: "radar_nfts", rows: [{ id: "first-row", payload: { id: "first-row" }, updated_at: syncedAt }] },
        { table: "radar_candidates", rows: [{ chain: "base", payload: { id: "missing-id" } }] },
      ],
    })).toThrow("SQLite radar_candidates record is missing its id.");

    expect(isSqliteIngestionEventRecorded("sqlite-event-rollback")).toBe(false);
    await expect(readPayloadTable("radar_nfts", 10)).resolves.toEqual([]);
  });
});
