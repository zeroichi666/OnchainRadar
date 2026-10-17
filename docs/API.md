# API reference

All routes are Next.js server routes. Read responses are `no-store`, sanitized, and rate-limited in-process. They never return server credentials. In demo mode, read routes return visibly labeled placeholders. Live mode does not fall back to demo data.

## Read routes

| Route | Purpose |
|---|---|
| `GET /api/dashboard` | Complete dashboard payload. Optional `settings=<URL-encoded JSON>` accepts the validated `RadarClientSettings` shape; it cannot turn off mandatory security checks. |
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

## Protected ingestion

All ingestion routes require `Authorization: Bearer <INGESTION_SECRET>` over HTTPS in production, plus `Content-Type: application/json`. Browser-supplied `Origin` values are checked against `APP_ORIGIN`, `SITE_URL`, `URL`, `DEPLOY_PRIME_URL`, and `ALLOWED_INGEST_ORIGINS`; server-to-server workers normally omit `Origin`. Responses are `no-store`. The service role remains server-only.

### `POST /api/ingest/social`

The primary Agent-Reach worker route (backward-compatible alias: `POST /api/ingest`). It validates `schemaVersion: 1`, `source: "agent-reach"`, `eventId`, `syncedAt`, and normalized arrays of `nfts`, `gtd`, `tokens`, and `narratives` using `src/lib/server/ingest-schema.ts`. Maximum body size is 1 MB. Repeating an accepted `eventId` is idempotent.

The schema deliberately does not accept provider security verdicts. X/social claims cannot assert `PASS`; the server performs its own chain-specific security checks.

### `POST /api/ingest/market`

Protected refresh body: `{"chain":"base","addresses":["0x..."]}`. Accepts 1–30 valid addresses, but only refreshes candidates already in Supabase; it cannot insert an arbitrary address. DEX Screener results and warnings are generated server-side.

### `POST /api/ingest/security`

Protected refresh body: `{"chain":"solana","address":"..."}`. The address must be valid and already stored as a candidate. The server calls its chain-appropriate security analyzer; submitted provider verdicts are not accepted. `202` means the result remains `UNKNOWN` and is not cleared into the main feed.

### Error/status behavior

- `401`: missing/invalid bearer secret
- `403`: browser Origin is not allowlisted
- `413`: body too large
- `415`: content type is not JSON
- `422`: invalid schema/address
- `429`: in-process rate limit exceeded; retry after the provided interval
- `503`: worker secret, Supabase, or required provider path is unavailable

The in-memory limiter is per serverless instance. Before public production traffic, add shared edge/WAF limits and monitor provider quotas.
