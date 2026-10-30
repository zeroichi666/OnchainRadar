import "server-only";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

type StoredTable =
  | "radar_candidates"
  | "radar_nfts"
  | "radar_gtd"
  | "radar_narratives"
  | "radar_social_posts"
  | "radar_cto_evidence"
  | "radar_security_reports";

type IngestionBatch = { table: StoredTable; rows: Record<string, unknown>[] };

export type ScanHistoryClearResult = {
  records: Record<StoredTable, number>;
  syncState: number;
  ingestionEvents: number;
};

const allowedTables = new Set<StoredTable>([
  "radar_candidates",
  "radar_nfts",
  "radar_gtd",
  "radar_narratives",
  "radar_social_posts",
  "radar_cto_evidence",
  "radar_security_reports",
]);

const requireFromProject = createRequire(resolve(process.cwd(), "package.json"));
const SQLITE_BACKUP_RETENTION = 7;
const SQLITE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SQLITE_BACKUP_RECHECK_MS = 60 * 60 * 1000;
const SQLITE_BACKUP_EMPTY_RECHECK_MS = 60 * 1000;
let database: SqliteDatabase | null = null;
let openedPath: string | null = null;
let nextSqliteBackupCheckAt = 0;

export function getSqliteDatabasePath(): string {
  const configured = process.env.SQLITE_DATABASE_PATH?.trim() || ".data/onchain-radar.sqlite";
  if (configured === ":memory:") return configured;
  return isAbsolute(configured)
    ? resolve(/* turbopackIgnore: true */ configured)
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function getDatabaseConstructor(): typeof import("node:sqlite").DatabaseSync {
  try {
    return (requireFromProject("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
  } catch {
    throw new Error("SQLite local storage requires Node.js 22.13 or newer with node:sqlite available.");
  }
}

function sqliteBackupDirectory(databasePath: string): string {
  return `${databasePath}.backups`;
}

function listSqliteBackups(databasePath: string): string[] {
  const directory = sqliteBackupDirectory(databasePath);
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("onchain-radar-") && entry.name.endsWith(".sqlite"))
      .map((entry) => entry.name)
      .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function latestSqliteBackupTime(databasePath: string): number | null {
  const directory = sqliteBackupDirectory(databasePath);
  const backups = listSqliteBackups(databasePath);
  if (!backups.length) return null;
  let latest = 0;
  for (const name of backups) {
    try {
      latest = Math.max(latest, statSync(join(directory, name)).mtimeMs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return latest || null;
}

function rotateSqliteBackups(databasePath: string): void {
  const directory = sqliteBackupDirectory(databasePath);
  for (const name of listSqliteBackups(databasePath).slice(SQLITE_BACKUP_RETENTION)) {
    try {
      rmSync(join(directory, name));
    } catch (error) {
      console.warn("Could not remove an expired SQLite backup.", error);
    }
  }
}

export function createSqliteBackup(
  db: SqliteDatabase = getSqliteDatabase(),
  databasePath: string = getSqliteDatabasePath(),
  createdAt: Date = new Date(),
): string | null {
  if (databasePath === ":memory:") return null;

  const directory = sqliteBackupDirectory(databasePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const backupPath = join(directory, `onchain-radar-${timestamp}-${randomUUID()}.sqlite`);
  const temporaryPath = `${backupPath}.tmp`;
  try {
    db.prepare("VACUUM INTO ?").run(temporaryPath);
    chmodSync(temporaryPath, 0o600);

    const verificationDatabase = new (getDatabaseConstructor())(temporaryPath);
    let integrity: string | undefined;
    try {
      integrity = (verificationDatabase.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    } finally {
      verificationDatabase.close();
    }
    if (integrity !== "ok") throw new Error(`SQLite backup integrity check failed: ${integrity ?? "no result"}.`);

    renameSync(temporaryPath, backupPath);
    try {
      rotateSqliteBackups(databasePath);
    } catch (error) {
      console.warn("Could not rotate older SQLite backups.", error);
    }
    return backupPath;
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original backup error. */ }
    throw error;
  }
}

function maybeCreatePeriodicSqliteBackup(db: SqliteDatabase, databasePath: string): void {
  if (databasePath === ":memory:") return;
  const now = Date.now();
  if (now < nextSqliteBackupCheckAt) return;
  nextSqliteBackupCheckAt = now + SQLITE_BACKUP_RECHECK_MS;

  try {
    const latestBackup = latestSqliteBackupTime(databasePath);
    if (latestBackup !== null && now - latestBackup < SQLITE_BACKUP_INTERVAL_MS) return;

    const storedData = db.prepare(`
      SELECT EXISTS (SELECT 1 FROM radar_records)
        OR EXISTS (SELECT 1 FROM radar_sync_state)
        OR EXISTS (SELECT 1 FROM radar_ingestion_events) AS present
    `).get() as { present: number };
    if (!storedData.present) {
      nextSqliteBackupCheckAt = now + SQLITE_BACKUP_EMPTY_RECHECK_MS;
      return;
    }

    createSqliteBackup(db, databasePath, new Date(now));
  } catch (error) {
    console.warn("Automatic SQLite backup failed; the database remains available.", error);
  }
}

export function getSqliteDatabase(): SqliteDatabase {
  const path = getSqliteDatabasePath();
  if (database && openedPath === path) {
    maybeCreatePeriodicSqliteBackup(database, path);
    return database;
  }
  if (database) database.close();
  nextSqliteBackupCheckAt = 0;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const DatabaseSync = getDatabaseConstructor();
  database = new DatabaseSync(path);
  openedPath = path;
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS radar_records (
      table_name TEXT NOT NULL CHECK (table_name IN (
        'radar_candidates', 'radar_nfts', 'radar_gtd', 'radar_narratives',
        'radar_social_posts', 'radar_cto_evidence', 'radar_security_reports'
      )),
      record_id TEXT NOT NULL,
      chain TEXT,
      token_address TEXT,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (table_name, record_id)
    );
    CREATE INDEX IF NOT EXISTS radar_records_updated_idx ON radar_records(table_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS radar_records_candidate_lookup_idx ON radar_records(table_name, chain, lower(token_address));
    CREATE TABLE IF NOT EXISTS radar_sync_state (
      source TEXT PRIMARY KEY,
      last_successful_at TEXT,
      details TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS radar_ingestion_events (
      event_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );
  `);
  maybeCreatePeriodicSqliteBackup(database, path);
  return database;
}

export function closeSqliteDatabase(): void {
  if (database) database.close();
  database = null;
  openedPath = null;
  nextSqliteBackupCheckAt = 0;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function recordPayload(row: Record<string, unknown>): unknown {
  return row.payload !== undefined ? row.payload : row;
}

function writeRecords(table: StoredTable, rows: Record<string, unknown>[], db = getSqliteDatabase()): void {
  if (!allowedTables.has(table)) throw new Error("Unsupported SQLite storage table.");
  const upsert = db.prepare(`
    INSERT INTO radar_records (table_name, record_id, chain, token_address, updated_at, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(table_name, record_id) DO UPDATE SET
      chain = excluded.chain,
      token_address = excluded.token_address,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `);
  const fallbackNow = new Date().toISOString();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) throw new Error(`SQLite ${table} record is missing its id.`);
    const payload = recordPayload(row);
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw new Error(`SQLite ${table} record could not be serialized.`);
    const updatedAt = typeof row.updated_at === "string"
      ? row.updated_at
      : typeof row.fetched_at === "string"
        ? row.fetched_at
        : typeof row.assessed_at === "string"
          ? row.assessed_at
          : fallbackNow;
    upsert.run(
      table,
      row.id,
      typeof row.chain === "string" ? row.chain : null,
      typeof row.token_address === "string" ? row.token_address.toLowerCase() : null,
      updatedAt,
      serialized,
    );
  }
}

export function readSqlitePayloadTable(table: Exclude<StoredTable, "radar_security_reports">, limit = 100): { payload: unknown }[] {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 100;
  const rows = getSqliteDatabase().prepare(
    "SELECT payload FROM radar_records WHERE table_name = ? ORDER BY updated_at DESC LIMIT ?",
  ).all(table, boundedLimit) as { payload: string }[];
  return rows.map((row) => ({ payload: parseJson(row.payload) }));
}

export function readSqlitePayloadRowsByIds(
  table: Exclude<StoredTable, "radar_security_reports">,
  ids: string[],
): { id: string; payload: unknown }[] {
  if (!ids.length) return [];
  const boundedIds = [...new Set(ids)].slice(0, 500);
  const placeholders = boundedIds.map(() => "?").join(",");
  const rows = getSqliteDatabase().prepare(
    `SELECT record_id AS id, payload FROM radar_records WHERE table_name = ? AND record_id IN (${placeholders})`,
  ).all(table, ...boundedIds) as { id: string; payload: string }[];
  return rows.map((row) => ({ id: row.id, payload: parseJson(row.payload) }));
}

export function readSqliteCandidatesByChainAddresses(chain: string, addresses: string[]): { payload: unknown }[] {
  const normalized = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 30);
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => "?").join(",");
  const rows = getSqliteDatabase().prepare(
    `SELECT payload FROM radar_records WHERE table_name = 'radar_candidates' AND chain = ? AND lower(token_address) IN (${placeholders}) LIMIT 30`,
  ).all(chain, ...normalized) as { payload: string }[];
  return rows.map((row) => ({ payload: parseJson(row.payload) }));
}

export function readSqliteSecurityReports(limit = 500): { report: unknown }[] {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(2000, Math.floor(limit))) : 500;
  const rows = getSqliteDatabase().prepare(
    "SELECT payload FROM radar_records WHERE table_name = 'radar_security_reports' ORDER BY updated_at DESC LIMIT ?",
  ).all(boundedLimit) as { payload: string }[];
  return rows.map((row) => ({ report: parseJson(row.payload) }));
}

export function readSqliteLastSuccessfulSync(source: string): string | null {
  const row = getSqliteDatabase().prepare(
    "SELECT last_successful_at FROM radar_sync_state WHERE source = ?",
  ).get(source) as { last_successful_at: string | null } | undefined;
  return row?.last_successful_at ?? null;
}

export function writeSqliteSyncState(source: string, lastSuccessfulAt: string, details: Record<string, unknown>): void {
  getSqliteDatabase().prepare(`
    INSERT INTO radar_sync_state (source, last_successful_at, details) VALUES (?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      last_successful_at = excluded.last_successful_at,
      details = excluded.details
  `).run(source, lastSuccessfulAt, JSON.stringify(details));
}

export function upsertSqliteRecord(table: StoredTable, row: Record<string, unknown>): void {
  writeRecords(table, [row]);
}

export function isSqliteIngestionEventRecorded(eventId: string): boolean {
  const row = getSqliteDatabase().prepare(
    "SELECT 1 AS present FROM radar_ingestion_events WHERE event_id = ?",
  ).get(eventId) as { present: number } | undefined;
  return Boolean(row);
}

export function commitSqliteIngestionIfNew(input: {
  eventId: string;
  source: string;
  ingestedAt: string;
  syncedAt: string;
  syncDetails: Record<string, unknown>;
  batches: IngestionBatch[];
}): boolean {
  const db = getSqliteDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT 1 AS present FROM radar_ingestion_events WHERE event_id = ?").get(input.eventId);
    if (existing) {
      db.exec("ROLLBACK");
      return false;
    }
    for (const batch of input.batches) writeRecords(batch.table, batch.rows, db);
    db.prepare(`
      INSERT INTO radar_sync_state (source, last_successful_at, details) VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_successful_at = excluded.last_successful_at,
        details = excluded.details
    `).run(input.source, input.syncedAt, JSON.stringify(input.syncDetails));
    db.prepare("INSERT INTO radar_ingestion_events (event_id, source, ingested_at) VALUES (?, ?, ?)")
      .run(input.eventId, input.source, input.ingestedAt);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

export function clearSqliteScanHistory(): ScanHistoryClearResult {
  const db = getSqliteDatabase();
  const records = Object.fromEntries([...allowedTables].map((table) => [table, 0])) as Record<StoredTable, number>;
  const storedData = db.prepare(`
    SELECT EXISTS (SELECT 1 FROM radar_records)
      OR EXISTS (SELECT 1 FROM radar_sync_state)
      OR EXISTS (SELECT 1 FROM radar_ingestion_events) AS present
  `).get() as { present: number };
  if (storedData.present) createSqliteBackup(db, getSqliteDatabasePath());
  db.exec("BEGIN IMMEDIATE");
  try {
    const grouped = db.prepare("SELECT table_name, COUNT(*) AS count FROM radar_records GROUP BY table_name").all() as { table_name: StoredTable; count: number }[];
    for (const row of grouped) records[row.table_name] = Number(row.count);
    const syncState = Number((db.prepare("SELECT COUNT(*) AS count FROM radar_sync_state").get() as { count: number }).count);
    const ingestionEvents = Number((db.prepare("SELECT COUNT(*) AS count FROM radar_ingestion_events").get() as { count: number }).count);
    db.exec("DELETE FROM radar_records; DELETE FROM radar_sync_state; DELETE FROM radar_ingestion_events;");
    db.exec("COMMIT");
    return { records, syncState, ingestionEvents };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the original clear error. */ }
    throw error;
  }
}
