import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const servers = [];
const tempDirs = [];
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  return `http://127.0.0.1:${server.address().port}/api/ingest/social`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolvePromise) => server.close(resolvePromise))));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function runRunner(env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve("worker/run-agent-reach.mjs")], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("scheduled adapter runner", () => {
  it("forwards shutdown to the adapter and always removes the lock", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-worker-shutdown-test-"));
    tempDirs.push(dir);
    const lockPath = resolve(dir, "runner.lock");
    const pidPath = resolve(dir, "adapter.pid");
    const source = `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, [resolve("worker/run-agent-reach.mjs")], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, INGESTION_URL: "http://127.0.0.1:1", INGESTION_SECRET: "test", AGENT_REACH_ADAPTER: process.execPath, AGENT_REACH_ADAPTER_ARGS_JSON: JSON.stringify(["-e", source]), WORKER_LOCK_FILE: lockPath }, stdio: ["ignore", "pipe", "pipe"]
    });
    await new Promise((resolvePromise, reject) => {
      const poll = async () => { try { await access(pidPath); resolvePromise(); } catch { setTimeout(poll, 10); } };
      child.once("error", reject); poll();
    });
    child.kill("SIGTERM");
    const code = await new Promise((resolvePromise) => child.once("close", resolvePromise));
    assert.notEqual(code, 0);
    await assert.rejects(access(lockPath));
    const adapterPid = Number(await readFile(pidPath, "utf8"));
    assert.throws(() => process.kill(adapterPid, 0), /ESRCH/);
  });

  it("sends the normalized envelope while withholding ingestion and Supabase secrets from the adapter", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-worker-test-")); tempDirs.push(dir);
    let received;
    const endpoint = await listen((request, response) => {
      assert.equal(request.headers.authorization, "Bearer runner-secret");
      let body = ""; request.on("data", (chunk) => body += chunk); request.on("end", () => { received = JSON.parse(body); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true })); });
    });
    const source = `const payload = ${JSON.stringify({ schemaVersion: 1, eventId: "runner-test-event", source: "agent-reach", syncedAt: new Date().toISOString(), nfts: [], gtd: [], tokens: [], narratives: [] })}; payload.eventId = process.env.INGESTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY ? "secret-leaked" : "adapter-ran-safely"; process.stdout.write(JSON.stringify(payload));`;
    const result = await runRunner({
      INGESTION_URL: endpoint,
      INGESTION_SECRET: "runner-secret",
      SUPABASE_SERVICE_ROLE_KEY: "supabase-private-test-value",
      AGENT_REACH_ADAPTER: process.execPath,
      AGENT_REACH_ADAPTER_ARGS_JSON: JSON.stringify(["-e", source]),
      WORKER_LOCK_FILE: resolve(dir, "runner.lock"),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"accepted":true/);
    assert.equal(received.eventId, "adapter-ran-safely");
  });

  it("uses the default lock path when WORKER_LOCK_FILE is empty", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-worker-empty-lock-test-")); tempDirs.push(dir);
    let received;
    const endpoint = await listen((request, response) => {
      let body = ""; request.on("data", (chunk) => body += chunk); request.on("end", () => { received = JSON.parse(body); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true })); });
    });
    const source = `process.stdout.write(JSON.stringify({ schemaVersion: 1, eventId: "empty-lock-test", source: "agent-reach", syncedAt: new Date().toISOString(), nfts: [], gtd: [], tokens: [], narratives: [] }));`;
    const result = await runRunner({
      INGESTION_URL: endpoint,
      INGESTION_SECRET: "runner-secret",
      AGENT_REACH_ADAPTER: process.execPath,
      AGENT_REACH_ADAPTER_ARGS_JSON: JSON.stringify(["-e", source]),
      WORKER_LOCK_FILE: "",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"accepted":true/);
    assert.equal(received.eventId, "empty-lock-test");
  });

  it("skips a run when the configured lock file already exists", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "radar-worker-held-lock-test-")); tempDirs.push(dir);
    const lockPath = resolve(dir, "runner.lock");
    const markerPath = resolve(dir, "adapter-ran");
    await writeFile(lockPath, "");
    const source = `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran");`;
    const result = await runRunner({
      INGESTION_URL: "http://127.0.0.1:1/api/ingest/social",
      INGESTION_SECRET: "runner-secret",
      AGENT_REACH_ADAPTER: process.execPath,
      AGENT_REACH_ADAPTER_ARGS_JSON: JSON.stringify(["-e", source]),
      WORKER_LOCK_FILE: lockPath,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { skipped: true, reason: "worker lock already held" });
    await assert.rejects(access(markerPath));
  });
});
