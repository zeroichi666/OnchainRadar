# Scheduled Agent-Reach worker

This worker runs outside the browser and outside Netlify Functions. `ingest.mjs` transports a normalized batch to the protected API. `run-agent-reach.mjs` is a scheduler entry point that starts a separately configured Agent-Reach command or project adapter; it does not guess the CLI subcommand, login method, cookie name, or output format.

## What must be configured

In the worker host environment (not committed to Git):

- `INGESTION_URL=https://<your-site>/api/ingest/social`
- `INGESTION_SECRET=<the same strong secret configured server-side>`
- `AGENT_REACH_ADAPTER=<verified executable or project-specific wrapper>`
- `AGENT_REACH_ADAPTER_ARGS_JSON=[]` (a JSON array of literal arguments, never a shell string)
- Optionally `AGENT_REACH_ENV_ALLOWLIST=<comma-separated environment variable names>` for the exact authentication inputs required by the installed Agent-Reach version.
- Optionally `AGENT_REACH_TIMEOUT_MS=120000` and `WORKER_LOCK_FILE=/var/lib/onchain-radar/worker.lock`.

The runner passes only `PATH`, `HOME`, locale/temp variables, and explicitly allowlisted variables to the adapter. It never passes `INGESTION_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; it uses `spawn(..., {shell:false})`, limits stdout to 1 MB, enforces a timeout, and prevents overlapping runs using a lock file. Adapter stderr is suppressed so credentials or private post data are not copied to schedule logs. The adapter must print exactly one normalized JSON envelope to stdout.

Do not put session cookies or bearer values in source files, command arguments, or log output. Use the authentication method documented by the exact Agent-Reach version and its underlying X tool. Restrict worker host access and filesystem permissions.

## Configure a version-specific adapter

Check the current Agent-Reach documentation and supported authentication on the actual worker host. Implement or select a wrapper that:

1. Runs supported Agent-Reach searches from the project query configuration in `config/x-queries.json`.
2. Extracts only fields returned by the tool (post text/URL/author/time/engagement, token address/chain, mint details, and narrative evidence).
3. Normalizes them to the strict schema in `src/lib/server/ingest-schema.ts` (see also `docs/API.md`).
4. Writes a single JSON envelope on stdout, with no logging text mixed into it.

No social worker can create a security verdict. The server rechecks candidates with its own providers and keeps missing, stale, conflicting, and critical results out of the primary feed.

## Run once

Transport an already normalized file or stdin batch:

```bash
node worker/ingest.mjs path/to/normalized-batch.json
cat normalized-batch.json | node worker/ingest.mjs
```

Run the configured Agent-Reach adapter once:

```bash
node worker/run-agent-reach.mjs
```

For local transport tests only, HTTP to `localhost` is allowed. Production endpoints must use HTTPS.

## Schedule

Use the worker host's cron or systemd timer; choose an interval consistent with X/Agent-Reach and provider limits. Example cron entry (install a protected environment file with mode `0600`; do not put secret assignments directly in the crontab):

```cron
*/15 * * * * cd /opt/onchain-radar && /usr/bin/node worker/run-agent-reach.mjs >> /var/log/onchain-radar-worker.log 2>&1
```

The run is bounded by a lock and timeout. The ingestion endpoint itself rate-limits requests, caps payload size, validates schema and HTTPS source links, deduplicates posts, and records the last successful sync. The worker retries network failures and HTTP 429/5xx with bounded backoff; permanent 4xx responses are not retried.

## Normalized envelope

```json
{
  "schemaVersion": 1,
  "source": "agent-reach",
  "eventId": "unique-id-from-the-worker-run",
  "syncedAt": "2026-01-01T00:00:00.000Z",
  "nfts": [],
  "gtd": [],
  "tokens": [],
  "narratives": []
}
```

Each object is validated by Zod server-side. NFT free/low-cost status and GTD confirmation are normalized against supplied evidence. Social posts do not set security fields. `eventId` idempotency makes a safe retry possible after an ambiguous network failure.
