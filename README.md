# Onchain Radar

Onchain Radar is a security-first Web3 discovery dashboard for NFT mints, GTD allocations, meme-token candidates, community takeovers, and X narratives. It is a Next.js/TypeScript application with a server-only provider layer, Supabase persistence, Zod validation, and a separate scheduled social-ingestion worker. Netlify serves the dashboard/API; it does not run the Agent-Reach CLI.

## Start locally

Requirements: Node.js 20.9+ and npm. From this directory:

```bash
npm install
cp .env.example .env.local
npm run dev
```

The default is `DATA_MODE=demo`. Demo records are visibly labeled fictional placeholders, with no fake token addresses, social URLs, or market metrics. Live mode never falls back to sample data. Open `http://localhost:3000`.

## Implemented modules

- **Overview:** summary cards, sync/provider status, recent exclusions, and discovery sections.
- **Free Mint / GTD Mint:** separate tables with chain, type, status, schedule, eligibility, verification and source filters. A social post alone cannot establish a free mint or guaranteed allocation.
- **Meme Coins:** search, chain/security filters, sortable and paginated feed. A token must have a valid address, fresh chain-appropriate mandatory checks, sufficient liquidity and market-cap ratio, and must pass enabled screening filters before it is ranked. Unknown, stale, conflicting, or failing results remain outside the feed.
- **Community Takeover:** confirmed/probable CTOs appear only after security clearance; unresolved claims remain separately labeled.
- **X Narratives:** stored metrics/time series and source posts only; unavailable historical data is not fabricated.
- **Security Review:** pending/incomplete candidates, raw per-provider reports, and recent exclusions.
- **Watchlist / Settings:** local-device watchlist and configurable screening thresholds/toggles. Mandatory security checks cannot be disabled.
- **Token details:** chain explorer/pair links, available market and security metrics, provider-supplied chart series, narrative links, CTO evidence, and source posts.

## Architecture

```text
Agent-Reach-capable worker / documented adapter
        -> POST /api/ingest/social (Bearer secret, strict schema, rate/body limits)
        -> Supabase PostgreSQL (RLS, no anonymous policies, idempotent batches)
        -> Next.js server routes (sanitized read APIs, market/security refresh)
        -> responsive dashboard
```

Market data is fetched server-side through the documented DEX Screener pair-token endpoint. EVM security uses the GoPlus adapter; Solana security uses chain-specific RPC checks and intentionally returns incomplete/unknown when unsupported Token-2022 or holder/liquidity checks cannot be established. Provider results are cached by chain/address and rechecked using `SECURITY_TTL_SECONDS`.

See [`docs/API.md`](docs/API.md), [`docs/research-notes.md`](docs/research-notes.md), [`supabase/schema.sql`](supabase/schema.sql), and [`worker/README.md`](worker/README.md).

## Configure live mode

1. Create a Supabase project and apply [`supabase/migrations/202610170001_initial.sql`](supabase/migrations/202610170001_initial.sql) (or the equivalent `schema.sql`). The migration creates structured token, NFT, GTD, narrative, social-post, CTO-evidence, provider-security, sync, and idempotency tables. RLS is enabled; no `anon` or `authenticated` policies are granted.
2. Set private server variables in Netlify or `.env.local`: `DATA_MODE=live`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `INGESTION_SECRET`. Never use a `NEXT_PUBLIC_` prefix for secrets.
3. Optionally configure `GOPLUS_ACCESS_TOKEN`, `SOLANA_RPC_URL`, `SECURITY_TTL_SECONDS`, `MIN_LIQUIDITY_USD`, `APP_ORIGIN`, and `ALLOWED_INGEST_ORIGINS`.
4. Run a separate worker in an environment where the selected Agent-Reach version and its supported authentication are configured. It must emit the documented normalized envelope and POST to `https://<site>/api/ingest/social` with the same `INGESTION_SECRET`.
5. Configure the external scheduler (for example, cron or a systemd timer) at the interval appropriate to the worker/provider limits. Example and security notes are in `worker/README.md`.

The repo deliberately does not invent an Agent-Reach subcommand, login flow, cookie name, or parser. `worker/run-agent-reach.mjs` invokes an explicitly configured executable with `shell: false`, a controlled environment allowlist, a lock and timeout; a project-specific adapter must follow the exact Agent-Reach documentation/version and print one valid envelope to stdout.

## Deploy to Netlify

Connect this repository to Netlify, use the included `netlify.toml`, and set the environment variables above in the site settings. Apply the Supabase migration before switching to live mode. Social collection remains on the separate worker; Netlify functions only accept normalized protected batches and serve read APIs. Build locally first with `npm run build`.

## Tests

```bash
npm run typecheck
npm test
npm run test:worker
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest tests cover address validation, security-gate behavior, provider failures, classification, normalized ingestion validation, and rate limiting. The Node worker suite tests bearer transport, HTTPS policy, retry behavior for 429, and non-retry for permanent 422 errors. Playwright smoke tests are configured; see `tests/` for the scenarios run against a local server.

## Current boundaries

- No external credentials or database were available in this implementation session; live mode, Netlify deployment, and actual Agent-Reach/X ingestion were not connected or executed. Demo mode and provider logic are explicit and testable locally.
- `npm run build` and local production HTTP smoke checks pass; Netlify TOML parses correctly. A local Netlify CLI build stopped before running the plugin because no Netlify project/site ID is linked, so deploy-specific output still needs verification after the repository is connected.
- Agent-Reach CLI commands, its authentication mechanism, and source output format vary by version/tool; a verified adapter is required before the scheduled worker can collect real X records.
- GoPlus/RPC/provider coverage is chain- and field-specific. Solana holder distribution, Token-2022 extensions, liquidity control, bundle/sniper signals, and reliable developer attribution are not treated as known when the configured source does not supply them. Enabled filters fail closed on missing required data.
- DEX Screener provides market snapshots rather than a historical OHLCV series in this integration; charts are blank unless real time-series points arrive in an accepted record.
- No security scanner guarantees safety; this is screening, not investment advice.
- In-memory rate limiting is per serverless instance. Use a shared edge/WAF rate limiter before public production traffic.

## License / use

Review the upstream provider terms and configure appropriate rate limits before public production use.
