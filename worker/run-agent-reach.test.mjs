import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
});
