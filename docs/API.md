# API reference

All routes are Next.js server routes. Read responses are `no-store`, sanitized, and rate-limited in-process. They never return server credentials. In demo mode, read routes return visibly labeled placeholders. Live mode does not fall back to demo data.

## Read routes

| Route | Purpose |
|---|---|
| `GET /api/dashboard` | Complete dashboard payload. Optional `settings=<URL-encoded JSON>` accepts the validated `RadarClientSettings` shape; it cannot turn off mandatory security checks. Optional `socialDate=today` or `socialDate=YYYY-MM-DD` filters only the detected social claim queue by post publication date in `Asia/Jakarta` (WIB), not the mint schedule. Omit it for all stored history. |
| `GET /api/health` | Mode, provider adapter/configuration status, and recent worker-sync status. `adapter-ready` does not mean a live upstream ping succeeded. |
| `GET /api/sync/status` | Agent-Reach/X last successful sync, age, and six-hour freshness indicator. |
| `GET /api/tokens` | Approved token feed with `chain`, `q`, `minMarketCap`, `security=PASS|WARNING`, `sort=score|name|marketCap|liquidity|change`, `period=1h|24h`, `page`, `pageSize`, and optional validated `settings`. |
| `GET /api/tokens/:chain/:address` | Detail for an address only if it is currently in the security-cleared feed. Returns merged verdict and raw provider results. |
| `GET /api/nfts/free-mints` | Free, conditional-free and low-cost mint candidates; supports `chain`, `status`, `eligibility`, `verification`, `from`, `to`, and `type`. |
| `GET /api/nfts/gtd-mints` | GTD opportunities with `chain`, `status`, `from`, and `to` filters. “Officially confirmed” requires verified official evidence. |
| `GET /api/cto` | Security-cleared verified/probable CTOs, with unresolved claims in a separate `review` array. |
| `GET /api/narratives` | Stored narrative metrics, time series, and original source posts; optional `q`. |
| `GET /api/security/review` | Pending/incomplete/conflicting candidate queue, security exclusions, merged reports and provider-specific reports. |

Read routes return JSON and use HTTP 400 for invalid filters, 404 for unknown/non-cleared token detail, 429 for rate limiting, and a generic server error if data cannot be loaded.

The dashboard date-filter response exposes `X-Social-Date` and `X-Social-Time-Zone` headers. This is a read-time view only: historical posts remain stored, and the normal dashboard UI can switch between a chosen WIB date and all history. Live worker searches default to today's WIB date and enforce exact post timestamps after X's date-only source query filtering.

With `DATA_MODE=live`, `STORAGE_PROVIDER` selects persistence: `supabase` is the default; `sqlite` uses `SQLITE_DATABASE_PATH` (default `.data/onchain-radar.sqlite`). SQLite is intended for local or self-hosted persistent disks, not ephemeral serverless storage. The health endpoint reports the active backend and SQLite creates its file automatically.

## Protected ingestion

All ingestion routes require `Authorization: Bearer <INGESTION_SECRET>` over HTTPS in production, plus `Content-Type: application/json`. Browser-supplied `Origin` values are checked against `APP_ORIGIN`, `SITE_URL`, `URL`, `DEPLOY_PRIME_URL`, and `ALLOWED_INGEST_ORIGINS`; server-to-server workers normally omit `Origin`. Responses are `no-store`. The service role remains server-only.

### `POST /api/ingest/social`

The primary Agent-Reach worker route (backward-compatible alias: `POST /api/ingest`). It validates `schemaVersion: 1`, `source: "agent-reach"`, `eventId`, `syncedAt`, and normalized arrays of `nfts`, `gtd`, `tokens`, and `narratives` using `src/lib/server/ingest-schema.ts`. The worker stores Free VPS search results as the standard `Free VPS` narrative category with original X posts; no provider or offer is independently verified by ingestion. Maximum body size is 1 MB. Repeating an accepted `eventId` is idempotent.

The schema deliberately does not accept provider security verdicts. X/social claims cannot assert `PASS`; the server performs its own chain-specific security checks.

### `POST /api/ingest/market`

Protected refresh body: `{"chain":"base","addresses":["0x..."]}`. Accepts 1–30 valid addresses, but only refreshes candidates already in the selected storage backend; it cannot insert an arbitrary address. DEX Screener results and warnings are generated server-side.

### `POST /api/ingest/security`

Protected refresh body: `{"chain":"solana","address":"..."}`. The address must be valid and already stored as a candidate. The server calls its chain-appropriate security analyzer; submitted provider verdicts are not accepted. `202` means the result remains `UNKNOWN` and is not cleared into the main feed.

## Protected scan-history deletion

`DELETE /api/admin/scan-history` permanently clears all scan-derived rows from the active provider: candidates, NFT and GTD records, narratives, source posts, CTO evidence, security reports, sync-state rows, and ingestion-event IDs. The event IDs are removed so a later worker batch is not treated as an old duplicate. The browser's curated screening settings and watchlist are not stored in these tables and are not deleted. SQLite runs the clear in one transaction; Supabase uses the service-role-only `clear_scan_history()` RPC so the table deletes are atomic.

The request must include `Authorization: Bearer <SCAN_HISTORY_DELETE_SECRET>`, an exact allowlisted `Origin`, and JSON body `{"confirmation":"HAPUS SEMUA RIWAYAT SCAN"}`. The UI asks the operator to type the phrase and enter the server secret for each deletion; it does not persist the secret. Use a separate random secret of at least 32 bytes, never `INGESTION_SECRET`, and configure `APP_ORIGIN` or `ALLOWED_INGEST_ORIGINS` for the exact site origin. Requests with no Origin are rejected. No wildcard CORS is enabled. The endpoint fails closed with `503` when the secret, Origin allowlist, live storage, or Supabase function is not configured.

For an existing Supabase project, apply `supabase/migrations/202610300001_clear_scan_history.sql` before enabling this action. New projects using `supabase/schema.sql` receive the RPC in the bootstrap schema. Configure `SCAN_HISTORY_DELETE_SECRET` and the correct origin in the server environment (including Netlify environment variables, if used). Keep a database backup if recovery may be needed; deletion cannot be undone by the app.

Success returns `{ "cleared": true, "provider": "sqlite|supabase", "records": { ... }, "syncState": n, "ingestionEvents": n }`. The response is `no-store`. Other relevant responses: `401` for invalid bearer secret, `403` for missing/disallowed Origin, `415` for non-JSON content, `422` when the exact confirmation is missing, `429` for rate limiting, and `503` for unavailable configuration or storage.

### Error/status behavior

- `401`: missing/invalid bearer secret
- `403`: browser Origin is not allowlisted
- `413`: body too large
- `415`: content type is not JSON
- `422`: invalid schema/address
- `429`: in-process rate limit exceeded; retry after the provided interval
- `503`: worker secret, selected storage backend, or required provider path is unavailable

The in-memory limiter is per serverless instance. Before public production traffic, add shared edge/WAF limits and monitor provider quotas.
