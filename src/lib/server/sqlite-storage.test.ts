import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { IngestionEnvelopeSchema } from "@/lib/server/ingest-schema";
import { clearScanHistory, getStorageStatus, persistIngestion, readCandidatesByChainAddresses, readLastSuccessfulSync, readPayloadRowsByIds, readPayloadTable, readSecurityReports } from "@/lib/server/supabase";
import { closeSqliteDatabase, commitSqliteIngestionIfNew, createSqliteBackup, getSqliteDatabase, isSqliteIngestionEventRecorded, upsertSqliteRecord, writeSqliteSyncState } from "@/lib/server/sqlite-storage";

const syncedAt = "2026-10-30T00:00:00.000Z";
const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "onchain-radar-sqlite-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "history.sqlite");
}

function listBackups(databasePath: string): string[] {
  return readdirSync(`${databasePath}.backups`).filter((name) => name.endsWith(".sqlite"));
}

describe("local SQLite storage", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_MODE", "live");
    vi.stubEnv("STORAGE_PROVIDER", "sqlite");
    vi.stubEnv("SQLITE_DATABASE_PATH", ":memory:");
  });
  afterEach(() => {
    closeSqliteDatabase();
    vi.useRealTimers();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

  it("clears every scan table and operational marker in one active-provider operation", async () => {
    const tables = ["radar_candidates", "radar_nfts", "radar_gtd", "radar_narratives", "radar_social_posts", "radar_cto_evidence", "radar_security_reports"] as const;
    for (const table of tables) upsertSqliteRecord(table, { id: `row-${table}`, updated_at: syncedAt, payload: { id: `row-${table}` } });
    writeSqliteSyncState("agent-reach", syncedAt, { eventId: "old-event" });
    writeSqliteSyncState("security:base", syncedAt, { checked: 1 });
    commitSqliteIngestionIfNew({ eventId: "old-event", source: "agent-reach", ingestedAt: syncedAt, syncedAt, syncDetails: {}, batches: [] });

    const result = await clearScanHistory();

    expect(result.records).toEqual(Object.fromEntries(tables.map((table) => [table, 1])));
    expect(result.syncState).toBe(2);
    expect(result.ingestionEvents).toBe(1);
    const remaining = getSqliteDatabase().prepare("SELECT COUNT(*) AS count FROM radar_records").get() as { count: number };
    expect(Number(remaining.count)).toBe(0);
    expect(isSqliteIngestionEventRecorded("old-event")).toBe(false);
    await expect(readLastSuccessfulSync("agent-reach")).resolves.toBeNull();
    await expect(readPayloadTable("radar_candidates", 10)).resolves.toEqual([]);
  });

  it("automatically creates a verified backup and restores stored data from it", async () => {
    const databasePath = createDatabasePath();
    vi.stubEnv("SQLITE_DATABASE_PATH", databasePath);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
    const original = {
      id: "restore-candidate",
      updated_at: syncedAt,
      payload: { id: "restore-candidate", state: "before" },
    };
    upsertSqliteRecord("radar_candidates", original);

    vi.setSystemTime(new Date("2026-10-30T00:01:01.000Z"));
    getSqliteDatabase();
    const backups = listBackups(databasePath);
    expect(backups).toHaveLength(1);
    const backupPath = join(`${databasePath}.backups`, backups[0]);

    upsertSqliteRecord("radar_candidates", {
      ...original,
      updated_at: "2026-10-30T00:02:00.000Z",
      payload: { id: "restore-candidate", state: "after" },
    });
    closeSqliteDatabase();

    // Mirror the documented restore flow: stop/close SQLite, replace the file, then remove stale WAL sidecars.
    copyFileSync(backupPath, databasePath);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });

    await expect(readPayloadRowsByIds("radar_candidates", [original.id])).resolves.toEqual([
      { id: original.id, payload: original.payload },
    ]);
  });

  it("backs up scan history immediately before clearing it", async () => {
    const databasePath = createDatabasePath();
    vi.stubEnv("SQLITE_DATABASE_PATH", databasePath);
    const candidate = { id: "before-clear", updated_at: syncedAt, payload: { id: "before-clear", state: "saved" } };
    upsertSqliteRecord("radar_candidates", candidate);

    const result = await clearScanHistory();

    expect(result.records.radar_candidates).toBe(1);
    const backups = listBackups(databasePath);
    expect(backups).toHaveLength(1);
    closeSqliteDatabase();
    copyFileSync(join(`${databasePath}.backups`, backups[0]), databasePath);
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    await expect(readPayloadTable("radar_candidates", 10)).resolves.toEqual([{ payload: candidate.payload }]);
  });

  it("retains only the seven newest SQLite backups", () => {
    const databasePath = createDatabasePath();
    vi.stubEnv("SQLITE_DATABASE_PATH", databasePath);
    upsertSqliteRecord("radar_candidates", { id: "rotation-test", payload: { id: "rotation-test" } });
    const db = getSqliteDatabase();

    for (let day = 1; day <= 8; day += 1) {
      createSqliteBackup(db, databasePath, new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`));
    }

    const backups = listBackups(databasePath);
    expect(backups).toHaveLength(7);
    expect(backups.some((name) => name.includes("2026-10-01T00-00-00-000Z"))).toBe(false);
    expect(backups.some((name) => name.includes("2026-10-08T00-00-00-000Z"))).toBe(true);
  });
});
