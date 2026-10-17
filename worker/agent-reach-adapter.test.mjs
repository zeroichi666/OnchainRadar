import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildEnvelope, normalizeTweet, parseSearchOutput, selectSearches } from "./agent-reach-adapter.mjs";

const servers = [];
const tempDirs = [];
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  return `http://127.0.0.1:${server.address().port}/api/ingest/social`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolvePromise) => server.close(resolvePromise))));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function runNode(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("Agent-Reach / twitter-cli adapter", () => {
  it("preserves only source-provided tweet fields and does not invent URLs or metrics", () => {
    const post = normalizeTweet({
      id: "tweet-1",
      text: "Base launch $NEON CA: 0x1111111111111111111111111111111111111111",
      author: { screenName: "radar_source" },
      createdAt: "2026-10-17T08:00:00.000Z",
      metrics: { likes: 4, retweets: 2, replies: 1 },
    });
    assert.equal(post.externalId, "tweet-1");
    assert.equal(post.author, "radar_source");
    assert.equal(post.publishedAt, "2026-10-17T08:00:00.000Z");
    assert.equal(post.sourceUrl, undefined);
    assert.equal(post.authorUrl, undefined);
    assert.equal(post.likes, 4);
    assert.equal(post.reposts, 2);
    assert.equal(post.replies, 1);
  });

  it("builds real-source narratives and only extracts a token when ticker, address, and one explicit chain are present", () => {
    const syncedAt = "2026-10-17T08:30:00.000Z";
    const url = "https://x.com/radar_source/status/42";
    const envelope = buildEnvelope([{
      group: "meme",
      query: "Base meme coin",
      tweets: [
        {
          id: "42",
          url,
          text: "Base chain $NEON CA: 0x1111111111111111111111111111111111111111",
          author: { screenName: "radar_source" },
          createdAt: syncedAt,
          metrics: { likes: 4, retweets: 2, replies: 1 },
        },
        {
          id: "43",
          text: "Something new is happening, but no address or network is stated.",
          author: { screenName: "another_source" },
        },
      ],
    }], syncedAt);
    assert.equal(envelope.source, "agent-reach");
    assert.equal(envelope.nfts.length, 0);
    assert.equal(envelope.gtd.length, 0);
    assert.equal(envelope.tokens.length, 1);
    assert.equal(envelope.tokens[0].chain, "base");
    assert.equal(envelope.tokens[0].address, "0x1111111111111111111111111111111111111111");
    assert.equal(envelope.tokens[0].symbol, "NEON");
    assert.equal(envelope.tokens[0].name, "$NEON");
    assert.equal(envelope.tokens[0].sourcePosts[0].sourceUrl, url);
    assert.equal(envelope.tokens[0].xMentionCount, 1);
    assert.equal(envelope.tokens[0].xEngagement, 7);
    assert.equal(envelope.narratives[0].mentionCount, 2);
    assert.equal(envelope.narratives[0].engagement, null);
    assert.equal(envelope.narratives[0].uniqueAuthors, 2);
    assert.equal(envelope.narratives[0].growthPct, null);
  });

  it("rejects unsuccessful or non-JSON upstream envelopes", () => {
    assert.throws(() => parseSearchOutput("not json"), /valid JSON/);
    assert.throws(() => parseSearchOutput(JSON.stringify({ ok: false, error: { code: "not_authenticated" } })), /unsuccessful/);
    assert.deepEqual(parseSearchOutput(JSON.stringify({ ok: true, schema_version: "1", data: [] })), []);
  });

  it("merges a sparse duplicate followed by a richer source record without inventing fields", () => {
    const envelope = buildEnvelope([{
      group: "nft", query: "free mint NFT", tweets: [
        { id: "same-id", text: "FREE MINT @Project" },
        { id: "same-id", text: "FREE MINT @Project with source data", url: "https://x.com/source/status/same-id", author: { screenName: "source" }, createdAt: "2026-10-17T08:00:00.000Z", metrics: { likes: 3, retweets: 2, replies: 1 } },
      ],
    }], "2026-10-17T12:00:00.000Z");
    assert.equal(envelope.narratives[0].sourcePosts.length, 1);
    assert.equal(envelope.narratives[0].sourcePosts[0].sourceUrl, "https://x.com/source/status/same-id");
    assert.equal(envelope.narratives[0].sourcePosts[0].author, "source");
    assert.equal(envelope.narratives[0].sourcePosts[0].likes, 3);
  });

  it("rotates configured keywords fairly across categories and deduplicates repeated terms", () => {
    const config = { nft: ["n1", "n2"], meme: ["m1", "m2"], narratives: ["r1"] };
    assert.deepEqual(selectSearches(config, 3, 0), [
      { group: "nft", query: "n1" },
      { group: "meme", query: "m1" },
      { group: "narratives", query: "r1" },
    ]);
    assert.deepEqual(selectSearches(config, 3, 1), [
      { group: "nft", query: "n2" },
      { group: "meme", query: "m2" },
      { group: "narratives", query: "r1" },
    ]);
  });

  it("runs read-only twitter search and transports normalized results without forwarding ingestion secrets to the CLI", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-agent-reach-test-"));
    tempDirs.push(dir);
    const binDir = resolve(dir, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir));
    const capturePath = resolve(dir, "cli-capture.jsonl");
    const configPath = resolve(dir, "queries.json");
    const lockPath = resolve(dir, "worker.lock");
    await writeFile(configPath, JSON.stringify({ meme: ["Base meme coin"] }));
    const fakeCli = resolve(binDir, "twitter");
    await writeFile(fakeCli, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CAPTURE, JSON.stringify({ args, pythonPath: process.env.PYTHONPATH, noBytecode: process.env.PYTHONDONTWRITEBYTECODE, authPresent: Boolean(process.env.TWITTER_AUTH_TOKEN && process.env.TWITTER_CT0), ingestionSecretPresent: Boolean(process.env.INGESTION_SECRET), serviceKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) }) + "\\n");
process.stdout.write(JSON.stringify({ ok: true, schema_version: "1", data: [
  { id: "tweet-42", url: "https://x.com/radar_source/status/42", text: "Base chain $NEON CA: 0x1111111111111111111111111111111111111111", author: { screenName: "radar_source" }, createdAt: "2026-10-17T08:00:00.000Z", metrics: { likes: 4, retweets: 2, replies: 1 } },
  { id: "tweet-before-day", url: "https://x.com/radar_source/status/41", text: "Out-of-day Base chain $OLD CA: 0x2222222222222222222222222222222222222222", author: { screenName: "radar_source" }, createdAt: "2026-10-16T16:59:59.999Z" }
] }));
`);
    await chmod(fakeCli, 0o700);

    let accepted;
    const endpoint = await listen((request, response) => {
      assert.equal(request.headers.authorization, "Bearer ingestion-test-secret");
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        accepted = JSON.parse(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ accepted: true }));
      });
    });

    const env = {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      INGESTION_URL: endpoint,
      INGESTION_SECRET: "ingestion-test-secret",
      SUPABASE_SERVICE_ROLE_KEY: "supabase-secret-must-not-reach-cli",
      AGENT_REACH_ADAPTER: process.execPath,
      AGENT_REACH_ADAPTER_ARGS_JSON: JSON.stringify([resolve("worker/agent-reach-adapter.mjs")]),
      AGENT_REACH_ENV_ALLOWLIST: "TWITTER_AUTH_TOKEN,TWITTER_CT0,TWITTER_CLI_BIN,AGENT_REACH_QUERY_CONFIG,AGENT_REACH_SEARCH_DATE,AGENT_REACH_MAX_SEARCHES,AGENT_REACH_RESULTS_PER_QUERY,AGENT_REACH_QUERY_OFFSET,AGENT_REACH_QUERY_DELAY_MS,TEST_CAPTURE",
      AGENT_REACH_QUERY_CONFIG: configPath,
      AGENT_REACH_SEARCH_DATE: "2026-10-17",
      TWITTER_CLI_BIN: fakeCli,
      AGENT_REACH_MAX_SEARCHES: "1",
      AGENT_REACH_RESULTS_PER_QUERY: "2",
      AGENT_REACH_QUERY_OFFSET: "0",
      AGENT_REACH_QUERY_DELAY_MS: "0",
      TEST_CAPTURE: capturePath,
      TWITTER_AUTH_TOKEN: "test-cookie-token-never-log",
      TWITTER_CT0: "test-cookie-csrf-never-log",
      WORKER_LOCK_FILE: lockPath,
    };
    const result = await runNode([resolve("worker/run-agent-reach.mjs")], env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"accepted":true/);
    const capture = JSON.parse((await readFile(capturePath, "utf8")).trim());
    assert.deepEqual(capture.args, ["search", "Base meme coin since:2026-10-16 until:2026-10-18", "--max", "2", "--json"]);
    assert.equal(capture.pythonPath, resolve(process.cwd(), "worker/twitter-cli-compat"));
    assert.equal(capture.noBytecode, "1");
    assert.equal(capture.authPresent, true);
    assert.equal(capture.ingestionSecretPresent, false);
    assert.equal(capture.serviceKeyPresent, false);
    assert.equal(accepted.source, "agent-reach");
    assert.equal(accepted.tokens[0].address, "0x1111111111111111111111111111111111111111");
    assert.equal(accepted.narratives[0].sourcePosts[0].sourceUrl, "https://x.com/radar_source/status/42");
    assert.equal(accepted.narratives[0].sourcePosts.length, 1);
    assert.equal(accepted.narratives[0].sourcePosts[0].externalId, "tweet-42");
    assert.equal(JSON.stringify(accepted).includes("test-cookie-token-never-log"), false);
  });

  it("fails closed before invoking twitter-cli when either explicit X cookie is missing", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-agent-reach-no-auth-"));
    tempDirs.push(dir);
    const binDir = resolve(dir, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir));
    const capturePath = resolve(dir, "cli-was-not-run");
    const fakeCli = resolve(binDir, "twitter");
    await writeFile(fakeCli, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.TEST_CAPTURE, "ran");\n`);
    await chmod(fakeCli, 0o700);
    const env = {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      TWITTER_AUTH_TOKEN: "test-only-auth",
      TEST_CAPTURE: capturePath,
    };
    const result = await runNode([resolve("worker/agent-reach-adapter.mjs")], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /both TWITTER_AUTH_TOKEN and TWITTER_CT0/);
    await assert.rejects(readFile(capturePath, "utf8"), { code: "ENOENT" });
    assert.equal(result.stderr.includes("test-only-auth"), false);
  });
});
