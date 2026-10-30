# Onchain Radar

Onchain Radar adalah dashboard discovery Web3 yang berfokus pada keamanan untuk NFT mint, GTD allocation, kandidat meme coin, community takeover, narasi X, Web3 Games, dan posting X tentang penawaran VPS gratis. Aplikasi ini memakai Next.js/TypeScript, provider server-only, Supabase, validasi Zod, serta worker sosial terjadwal yang berjalan terpisah.

> README ini adalah panduan utama. Jangan pernah memasukkan cookie X, key Supabase, token, atau nilai `.env.local` ke Git.

## Requirement

- Node.js **20.9+** dan npm; gunakan Node LTS yang masih didukung, misalnya 22/24.
- Dependensi Node dipasang dengan `npm ci` dari `package-lock.json`: Next.js, React, TypeScript, Supabase SDK, Zod, library chain/UI, Vitest, dan Playwright. Tidak ada dependensi Python aplikasi yang dideklarasikan di repository.
- Untuk pengumpulan X live: Python 3, upstream `twitter-cli` dengan executable `twitter`, dan dua cookie X yang valid. Shim Python tersedia di `worker/twitter-cli-compat/sitecustomize.py`.
- Agent-Reach adalah tool pendamping installer/router/doctor, **bukan dependensi npm**. Runtime adapter memanggil `twitter` secara langsung; Agent-Reach tidak wajib untuk menjalankan dashboard demo. Ikuti petunjuk upstream untuk instalasinya dan verifikasi interface CLI di [`worker/README.md`](worker/README.md).
- Untuk Supabase live storage: project Supabase dengan schema/migrasi yang sudah diterapkan. Mode SQLite lokal membutuhkan Node.js **22.13+** (`node:sqlite`). Untuk tes browser: Chromium Playwright atau executable browser yang kompatibel.

## Mulai lokal (demo)

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Buka `http://localhost:3000`. Default `DATA_MODE=demo`; record demo diberi label fiksi dan tidak memakai alamat token, URL sosial, atau metrik pasar palsu. Mode live tidak fallback ke data demo. `.env.local` dibaca server-side oleh Next.js. Jangan menampilkan, menyalin, atau commit file tersebut.

## Arsitektur

```text
worker Agent-Reach/twitter-cli
  -> POST /api/ingest/social (Bearer + schema/rate/body limit)
  -> SQLite lokal (transaksi/idempotent) atau Supabase PostgreSQL (RLS)
  -> Next.js server routes/provider refresh
  -> dashboard
```

Netlify hanya menjalankan dashboard/API Next.js; Netlify **tidak** menjalankan Agent-Reach CLI atau scheduler worker. Market data diambil server-side dari DEX Screener; pemeriksaan EVM memakai GoPlus dan Solana memakai RPC chain-specific. Hasil provider yang tidak diketahui, stale, konflik, atau gagal tidak masuk feed utama.

## Environment dan penempatan key

Salin `.env.example` ke `.env.local` untuk Next.js lokal. Di Netlify, masukkan variabel melalui Site settings/environment variables, bukan source control. Semua variabel berikut server-only: jangan beri prefix `NEXT_PUBLIC_`.

### Next.js/API

**Wajib untuk Supabase live storage (default):**

- `DATA_MODE=live`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — service role key hanya di server.
- `INGESTION_SECRET` — secret kuat yang sama dengan worker.

**Opsional:** `GOPLUS_ACCESS_TOKEN`, `SOLANA_RPC_URL` (default kode memakai public Solana endpoint), `SECURITY_TTL_SECONDS` (default kode 900), `MIN_LIQUIDITY_USD` (contoh `.env.example`: 5000), `APP_ORIGIN`, dan `ALLOWED_INGEST_ORIGINS`. `ALLOWED_INGEST_ORIGINS` dipakai sebagai allowlist origin bila diperlukan; endpoint ingestion tetap membutuhkan Bearer secret.

### Worker terpisah

Worker memuat `.env.local` dari project root bila ada: memakai `process.loadEnvFile` Node bila tersedia, atau fallback `@next/env`; nilai yang sudah diberikan host dipertahankan. Pada server produksi gunakan secret store dan permission file ketat (misalnya `chmod 600`), bukan commit `.env.local`.

**Wajib worker:** `INGESTION_URL=https://<site>/api/ingest/social`, `INGESTION_SECRET`, `AGENT_REACH_ADAPTER=node`, `AGENT_REACH_ADAPTER_ARGS_JSON=["worker/agent-reach-adapter.mjs"]`, serta `TWITTER_AUTH_TOKEN` dan `TWITTER_CT0`. Gunakan `AGENT_REACH_ENV_ALLOWLIST` dari `.env.example` untuk meneruskan cookie dan konfigurasi adapter. Konfigurasi query memakai `config/x-queries.json`, default maksimum 3 pencarian dan 10 hasil per query. Cookie X diletakkan hanya sebagai nilai secret `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` di environment worker; adapter tidak mencari cookie browser.

**Opsional worker:** `TWITTER_CLI_BIN`, `AGENT_REACH_SEARCH_DATE=YYYY-MM-DD`, `AGENT_REACH_QUERY_DELAY_MS` (default 500), `AGENT_REACH_SEARCH_TIMEOUT_MS`, `AGENT_REACH_QUERY_OFFSET`, `AGENT_REACH_TIMEOUT_MS` (runner default 120000), `WORKER_LOCK_FILE`, `HTTP_PROXY`, `HTTPS_PROXY`, dan `WORKER_INTERVAL_MS` (hanya override test/operasional terkontrol). Allowlist harus memuat hanya variabel yang diperlukan. Runner menolak meneruskan `INGESTION_SECRET` atau `SUPABASE_SERVICE_ROLE_KEY` ke adapter.

Detail instalasi dan shim ada di [`worker/README.md`](worker/README.md). Agent-Reach adalah installer/router/doctor untuk backend upstream, bukan perintah `agent-reach search` yang diciptakan project. Adapter saat ini memanggil interface upstream `twitter search <query> --max <count> --json`; jika versi tool berubah, verifikasi output dan sesuaikan adapter.

## Supabase dan live mode

### SQLite local mode

Untuk memakai data live tanpa project Supabase, jalankan aplikasi pada Node.js **22.13+** dan set di `.env.local`:

```dotenv
DATA_MODE=live
STORAGE_PROVIDER=sqlite
SQLITE_DATABASE_PATH=.data/onchain-radar.sqlite
INGESTION_SECRET=<secret-kuat-untuk-worker>
```

Tidak perlu mengisi `SUPABASE_URL` atau `SUPABASE_SERVICE_ROLE_KEY` dalam mode ini. File database dibuat otomatis; path relatif dihitung dari root proyek. Direktori `.data/` (termasuk file WAL SQLite) dikecualikan dari Git. Ingestion tetap memerlukan `INGESTION_SECRET` dan Bearer authorization seperti mode Supabase. `STORAGE_PROVIDER` yang tidak diisi tetap memilih Supabase demi kompatibilitas.

SQLite lokal ditujukan untuk satu aplikasi pada mesin lokal atau host mandiri dengan disk persisten. Jangan gunakan file lokal ini sebagai storage produksi pada Netlify/serverless atau beberapa instance, karena filesystem fungsi dapat bersifat sementara dan tidak dibagi antar-instance. Gunakan Supabase untuk deployment seperti itu. Simpan cadangan file database secara terpisah.

### Supabase live mode

1. Buat project Supabase.
2. Jalankan [`supabase/migrations/202610170001_initial.sql`](supabase/migrations/202610170001_initial.sql), atau gunakan [`supabase/schema.sql`](supabase/schema.sql) pada project baru.
3. Pastikan RLS aktif dan tidak menambahkan policy publik untuk service-role data.
4. Isi variabel Next.js di atas, jalankan aplikasi, lalu lakukan ingest dari worker. Live tidak dianggap aktif hanya karena variabel sudah diisi; harus ada batch worker sukses yang tercatat.

## Demo, refresh, dan worker

- Dashboard demo dapat dijalankan tanpa Supabase.
- UI dashboard melakukan auto-refresh **setiap 10 menit** dan mempertahankan snapshot saat request kosong/gagal; ini bukan pengumpulan X.
- `npm run worker` adalah scheduler proses terpisah: langsung menjalankan satu run lalu mengulang setiap **600000 ms (10 menit)**. Run yang masih berjalan dilewati, bukan diantrekan. Jangan menjalankan cron/systemd kedua yang menggandakan scheduler; bila memakai process manager, jalankan satu proses `npm run worker`.
- Worker membaca query dari `config/x-queries.json`; satu pencarian VPS diprioritaskan setiap run, sedangkan slot lain tetap berotasi. Hasil VPS disimpan sebagai posting X yang belum diverifikasi, bukan direktori provider. Worker mengirim satu envelope normalisasi, dan server melakukan validasi, deduplikasi, rate limit, serta pemeriksaan security sendiri.

## Perintah pengujian, build, dan deploy

```bash
npm run typecheck
npm test
npm run test:worker
npm run build
npx playwright install chromium   # hanya bila browser Playwright belum ada
npm run test:e2e
```

Deploy Netlify memakai `netlify.toml` (`npm run build`, plugin Next.js). Untuk Supabase live, set environment di Netlify dan apply migrasi lebih dahulu; SQLite lokal tidak cocok untuk filesystem serverless yang bisa sementara atau terpisah antar-instance. Build lokal sebelum deploy. Worker tetap dijalankan di host terpisah. Netlify CLI/deploy aktual tidak diklaim berhasil tanpa site/project Netlify yang terhubung.

## Push ke GitHub dengan aman (tanpa cookie/key)

`.gitignore` mengecualikan `.env`/`.env.*` kecuali `.env.example`, `.next`, log, report, dan lock worker. Sebelum commit, periksa perubahan dan pastikan tidak ada secret:

```bash
git status --short
git diff -- README.md worker/README.md
# review nama/path saja; jangan cat atau grep nilai .env.local
git diff --check
git add README.md worker/README.md
git diff --cached --check
git diff --cached --name-only
```

Contoh staging di atas hanya untuk perubahan dokumentasi; tambahkan file source yang memang ingin dikirim setelah ditinjau. Periksa isi staging dan riwayat dengan secret scanner sebelum push, karena `.gitignore` tidak menghapus file yang sudah pernah dilacak. Push melalui kredensial GitHub yang dikelola aman oleh host/credential manager. Jangan menaruh PAT di URL remote, commit, issue, log, atau README. Bila secret pernah terunggah, segera rotasi/revoke; menghapus file pada commit berikutnya tidak menghapusnya dari riwayat.

## Batas keamanan

Service-role key, `INGESTION_SECRET`, cookie X, dan token provider hanya berada di server/worker secret store. API ingestion memakai HTTPS untuk endpoint produksi, bearer authorization, schema ketat, batas body, rate limit, dan idempotency. Runner memakai `shell:false`, environment allowlist, lock, timeout, dan batas stdout. Shim hanya mengirim dua cookie ke bootstrap first-party X yang spesifik dan menghapus header/cookie sensitif dari request lain. Ini adalah screening, bukan jaminan keamanan atau nasihat investasi.

## Referensi

- [`docs/API.md`](docs/API.md)
- [`docs/research-notes.md`](docs/research-notes.md)
- [`supabase/schema.sql`](supabase/schema.sql)
- [`worker/README.md`](worker/README.md)
