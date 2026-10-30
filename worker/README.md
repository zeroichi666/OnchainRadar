# Worker Agent-Reach terjadwal

Worker ini berjalan di luar browser dan di luar Netlify Functions. `ingest.mjs` mengirim envelope ter-normalisasi ke API; `run-agent-reach.mjs` menjalankan adapter yang dikonfigurasi, mengambil stdout JSON, lalu mengirimnya. Worker tidak boleh diberi `SUPABASE_SERVICE_ROLE_KEY`.

> README utama ada di [`../README.md`](../README.md). Jangan commit `.env.local`, cookie X, bearer secret, atau key Supabase.

## Requirement

Gunakan Node.js 20.9+ (disarankan LTS 22/24), npm, Python 3, dan dependensi project hasil `npm ci`. Pengumpulan X memerlukan upstream `twitter-cli` dengan executable `twitter` serta cookie X yang valid. `uv` atau `pipx` dapat digunakan untuk mengelola tool Python secara terisolasi; keduanya bukan dependensi runtime aplikasi.

Agent-Reach adalah installer/router/doctor pendamping, bukan library npm dan bukan executable yang dipanggil adapter. Pasang tool sesuai dokumentasi versi upstream yang dipilih, lalu verifikasi di host worker (Agent-Reach hanya jika digunakan):

```bash
agent-reach --help
agent-reach doctor --help
twitter --help
twitter search --help
```

Perintah `agent-reach search` bukan interface yang dibuat repository ini. Adapter project saat ini memanggil executable upstream `twitter` dengan `twitter search <query> --max <count> --json`. Jika tool yang dipasang menghasilkan format berbeda, buat/perbarui wrapper yang mengikuti schema project; jangan langsung memasukkan output mentah.

Shim opsional di `twitter-cli-compat/sitecustomize.py` adalah workaround lokal untuk kompatibilitas `twitter-cli` 0.8.5 yang terdeteksi oleh test repository. Shim dipasang melalui `PYTHONPATH` hanya pada subprocess adapter; tidak mem-patch atau meng-install ulang paket user. Shim tidak menjadikan cookie aman untuk dibagikan.

## Cookie X dan secret worker

Cookie X **tidak** diletakkan di source, argumen command, log, browser-visible variable, atau GitHub. Simpan nilai dari Cookie Editor/export yang sah hanya di secret store host worker sebagai dua environment variable eksplisit:

- `TWITTER_AUTH_TOKEN`
- `TWITTER_CT0`

Adapter menolak berjalan bila salah satunya kosong. Ini mencegah upstream CLI mencoba pencarian cookie browser. Gunakan akun khusus dan pahami risiko rate-limit/akun X. `INGESTION_SECRET` hanya dipakai runner untuk API ingestion dan tidak masuk allowlist adapter; `SUPABASE_SERVICE_ROLE_KEY` tidak dibutuhkan worker dan dilarang diteruskan.

## Konfigurasi environment aktual

Buat `.env.local` hanya pada host worker lokal, atau gunakan secret manager pada server. Scheduler memuat `.env.local` dari project root bila file ada menggunakan `process.loadEnvFile` (fallback `@next/env`), tanpa menimpa variabel yang sudah diberikan host. Lindungi file (misalnya mode `0600`) dan jangan cetak nilainya.

**Wajib:**

- `INGESTION_URL=https://<site>/api/ingest/social` (HTTPS untuk produksi)
- `INGESTION_SECRET` yang sama dengan API
- `AGENT_REACH_ADAPTER=node`
- `AGENT_REACH_ADAPTER_ARGS_JSON=["worker/agent-reach-adapter.mjs"]` — array JSON string, bukan shell string
- `AGENT_REACH_ENV_ALLOWLIST` — daftar nama yang boleh diteruskan ke adapter
- `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`

Pengaturan query opsional: `AGENT_REACH_QUERY_CONFIG=config/x-queries.json`, `AGENT_REACH_MAX_SEARCHES` (default 3), dan `AGENT_REACH_RESULTS_PER_QUERY` (default 10).

Allowlist minimal yang dipakai adapter: `TWITTER_AUTH_TOKEN,TWITTER_CT0,TWITTER_CLI_BIN,AGENT_REACH_QUERY_CONFIG,AGENT_REACH_SEARCH_DATE,AGENT_REACH_MAX_SEARCHES,AGENT_REACH_RESULTS_PER_QUERY,AGENT_REACH_QUERY_DELAY_MS,AGENT_REACH_SEARCH_TIMEOUT_MS,AGENT_REACH_QUERY_OFFSET`. Tambahkan `HTTP_PROXY,HTTPS_PROXY` hanya bila benar-benar diperlukan.

**Opsional:** `TWITTER_CLI_BIN` (absolute path; bila kosong adapter mencoba `$HOME/.local/bin/twitter`, lalu `PATH`), `AGENT_REACH_SEARCH_DATE=YYYY-MM-DD` (default tanggal hari ini Asia/Jakarta), `AGENT_REACH_QUERY_DELAY_MS` (contoh `.env.example`: 500), `AGENT_REACH_SEARCH_TIMEOUT_MS` (timeout tiap pencarian), `AGENT_REACH_QUERY_OFFSET`, `AGENT_REACH_TIMEOUT_MS` (runner default 120000, dibatasi kode), `WORKER_LOCK_FILE`, dan `WORKER_INTERVAL_MS` (default 600000; override terkontrol untuk test). Jangan memasukkan `INGESTION_SECRET` atau `SUPABASE_SERVICE_ROLE_KEY` ke allowlist.

## Cara kerja adapter

Adapter membaca query dari `config/x-queries.json` untuk NFT, meme, narasi, Web3 Games, dan Free VPS. Dengan batas default tiga pencarian per run, satu slot diprioritaskan untuk query VPS dan dua slot lain berotasi; jumlah pencarian tidak bertambah. Hasil VPS menjadi posting X yang belum diverifikasi dan tidak diproses sebagai kandidat token atau direktori provider. Hasil game juga menjadi narasi bersumber X yang belum diverifikasi; ini bukan pemindaian kontrak on-chain atau audit keamanan game. Adapter hanya menerima respons JSON upstream dengan envelope `ok: true` dan `data: []`, membatasi hasil, menormalisasi field yang benar-benar ada (ID/text/URL/author/waktu/engagement), lalu mencetak tepat satu envelope JSON. Ia tidak membuat URL, metrik historis, NFT/GTD, atau security verdict. Kandidat token hanya dibuat bila tepat satu chain yang didukung, satu ticker, dan satu address eksplisit terdeteksi dari kategori selain VPS. Server tetap mengulang pemeriksaan security.

`AGENT_REACH_SEARCH_DATE` memilih hari publikasi pada zona `Asia/Jakarta`, bukan tanggal mint yang diklaim. Batch gagal/unauthenticated tidak dikirim sebagai sync sukses. `eventId` memungkinkan retry idempotent.

## Jalankan sekali

Dari root project:

```bash
# file JSON yang sudah dinormalisasi atau stdin
node --env-file=.env.local worker/ingest.mjs path/to/normalized-batch.json
cat normalized-batch.json | node --env-file=.env.local worker/ingest.mjs

# adapter live sekali
node --env-file=.env.local worker/run-agent-reach.mjs
```

Perintah satu kali tidak otomatis memuat `.env.local`; contoh di atas memuatnya melalui flag Node. Bila semua variabel sudah diberikan secret manager host, hilangkan `--env-file=.env.local`. Jangan memakai `source .env.local`: template memuat array JSON yang tidak ditujukan sebagai skrip shell.

Untuk live scan lokal dengan `STORAGE_PROVIDER=sqlite`, jalankan aplikasi Next.js pada loopback dan gunakan `INGESTION_URL=http://localhost:3000/api/ingest/social`; worker dan aplikasi perlu memakai `INGESTION_SECRET` yang sama. HTTP hanya untuk loopback lokal; endpoint produksi harus HTTPS.

## Scheduler 10 menit

```bash
npm run worker
```

Scheduler memuat env, menjalankan satu run segera, lalu memeriksa setiap **600000 ms (10 menit)**. Run yang masih aktif dilewati; kegagalan tidak mematikan interval berikutnya. `SIGINT`/`SIGTERM` menghentikan scheduler dan child process. Jangan menjalankan cron/systemd kedua yang juga memulai scheduler; bila perlu process manager, jalankan tepat satu proses `npm run worker`. `WORKER_INTERVAL_MS` hanya override eksplisit untuk test/operasional terkontrol.

Runner memakai lock file (default `.onchain-radar-worker.lock`, atau `WORKER_LOCK_FILE`), `shell:false`, environment allowlist, timeout, batas stdout 1 MB, dan tidak meneruskan stderr adapter ke log scheduler. Lock stale dapat diambil kembali setelah 2 jam sesuai kode. API memvalidasi schema, membatasi payload 1 MB, memakai bearer authorization/rate limit, deduplikasi, dan menyimpan sync sukses.

## Envelope minimum

```json
{
  "schemaVersion": 1,
  "source": "agent-reach",
  "eventId": "unique-id",
  "syncedAt": "2026-01-01T00:00:00.000Z",
  "nfts": [],
  "gtd": [],
  "tokens": [],
  "narratives": []
}
```

Schema lengkap divalidasi server-side; lihat [`../docs/API.md`](../docs/API.md) dan `src/lib/server/ingest-schema.ts`.

## Test dan troubleshooting aman

```bash
npm run typecheck
npm run test:worker
```

Test worker mencakup transport bearer/HTTPS, retry 429/5xx, non-retry 4xx permanen, lock/timeout/scheduler, normalisasi output, search-window, dan batas shim. Untuk masalah command, jalankan `agent-reach --help`, `agent-reach doctor --help`, dan `twitter --help` pada host worker—jangan menaruh cookie pada command line. Periksa hanya nama variabel, exit code, dan pesan generik; jangan menyalin stdout/log yang mungkin berisi data privat. Jika Agent-Reach memilih backend atau kontrak output lain, verifikasi versi dan ubah adapter/wrapper secara eksplisit.
