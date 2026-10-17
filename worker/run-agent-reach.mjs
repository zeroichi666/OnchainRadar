#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sendBatch } from "./ingest.mjs";

const MAX_OUTPUT_BYTES = 1_000_000;
const STALE_LOCK_MS = 2 * 60 * 60 * 1000;
const ADAPTER_STOP_TIMEOUT_MS = 2_000;
function parseArgs(raw) {
  const args = JSON.parse(raw || "[]");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("AGENT_REACH_ADAPTER_ARGS_JSON must be a JSON array of strings.");
  return args;
}
async function acquireLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true });
  try { return await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await stat(lockPath).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_LOCK_MS) {
      await unlink(lockPath).catch(() => {});
      try { return await open(lockPath, "wx", 0o600); } catch { return null; }
    }
    return null;
  }
}
function runAdapter(executable, args, env, timeoutMs, stopSignal) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { shell: false, env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    let size = 0;
    let settled = false;
    let killTimer;
    let terminationError;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (stopSignal) stopSignal.cancel = undefined;
      error ? reject(error) : resolvePromise(output);
    };
    const terminate = (message) => {
      if (settled || terminationError) return;
      terminationError = new Error(message);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
          finish(terminationError);
        }
      }, ADAPTER_STOP_TIMEOUT_MS);
    };
    const timeout = setTimeout(() => terminate("Agent-Reach adapter timed out."), timeoutMs);
    if (stopSignal) stopSignal.cancel = () => terminate("Worker shutdown requested.");
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) { terminate("Adapter output exceeded the 1 MB limit."); return; }
      chunks.push(chunk);
    });
    child.on("error", () => finish(new Error("Configured Agent-Reach adapter could not be started.")));
    child.on("close", (code) => terminationError ? finish(terminationError) : code === 0 ? finish(null, Buffer.concat(chunks).toString("utf8")) : finish(new Error(`Agent-Reach adapter exited with code ${code ?? "unknown"}.`)));
  });
}

async function main() {
  let activeStop;
  const onSignal = () => { activeStop?.(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const adapter = process.env.AGENT_REACH_ADAPTER;
  if (!adapter) throw new Error("Set AGENT_REACH_ADAPTER to a documented Agent-Reach command or a project-specific normalization wrapper.");
  if (!process.env.INGESTION_URL || !process.env.INGESTION_SECRET) throw new Error("Set INGESTION_URL and INGESTION_SECRET in the worker environment.");
  const args = parseArgs(process.env.AGENT_REACH_ADAPTER_ARGS_JSON);
  const allowed = new Set((process.env.AGENT_REACH_ENV_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const childEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[name]) childEnv[name] = process.env[name];
  for (const name of allowed) {
    if (["INGESTION_SECRET", "SUPABASE_SERVICE_ROLE_KEY"].includes(name)) throw new Error(`${name} cannot be passed to the Agent-Reach adapter.`);
    if (process.env[name] != null) childEnv[name] = process.env[name];
  }
  const lockPath = resolve(process.env.WORKER_LOCK_FILE ?? ".onchain-radar-worker.lock");
  const lock = await acquireLock(lockPath);
  if (!lock) { console.log(JSON.stringify({ skipped: true, reason: "worker lock already held" })); return; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.close();
    const timeoutMs = Math.max(10_000, Math.min(15 * 60_000, Number(process.env.AGENT_REACH_TIMEOUT_MS) || 120_000));
    const stopSignal = {};
    activeStop = () => stopSignal.cancel?.();
    const output = await runAdapter(adapter, args, childEnv, timeoutMs, stopSignal);
    let payload;
    try { payload = JSON.parse(output); } catch { throw new Error("Adapter stdout must contain one normalized JSON envelope and no other text."); }
    const result = await sendBatch(payload);
    console.log(JSON.stringify({ ...result, worker: "scheduled-adapter" }));
  } finally {
    activeStop = undefined;
    await unlink(lockPath).catch(() => {});
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Worker run failed."); process.exitCode = 1; });
