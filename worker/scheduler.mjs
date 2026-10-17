#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

/**
 * A fixed-interval scheduler. A run already in progress is skipped, rather
 * than queued, so a slow X request cannot create a backlog or overlap.
 */
export function createScheduler({
  run,
  stopRun = async () => {},
  intervalMs = DEFAULT_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = () => {},
} = {}) {
  if (typeof run !== "function") throw new TypeError("scheduler run must be a function");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError("scheduler interval must be positive");

  let timer;
  let current;
  let started = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || current) return;
    const promise = Promise.resolve().then(run);
    current = promise;
    try {
      await promise;
    } catch (error) {
      // A failed run must not terminate the scheduler or alter its interval.
      try { await onError(error); } catch { /* logging/reporting must not stop future runs */ }
    } finally {
      if (current === promise) current = undefined;
    }
  };

  return {
    start() {
      if (started || stopped) return this;
      started = true;
      timer = setIntervalFn(() => { void tick(); }, intervalMs);
      void tick();
      return this;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearIntervalFn(timer);
      // Let a pending run microtask spawn its child before asking it to stop.
      await Promise.resolve();
      try { await stopRun(); } catch { /* shutdown still waits for the run */ }
      if (current) await current.catch(() => {});
    },
    get running() { return Boolean(current); },
    get started() { return started; },
  };
}

export function createCommandRunner({
  command = process.execPath,
  args = [resolve(dirname(fileURLToPath(import.meta.url)), "run-agent-reach.mjs")],
  cwd = process.cwd(),
  env = process.env,
  spawnFn = spawn,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
} = {}) {
  let child;
  let settled;
  let stopTimer;

  const run = () => {
    if (settled) throw new Error("Command runner cannot be reused after shutdown.");
    return new Promise((resolvePromise, reject) => {
      const childEnv = { ...env };
      child = spawnFn(command, args, { cwd, env: childEnv, shell: false, stdio: "ignore" });
      settled = { resolve: resolvePromise, reject };
      child.once("error", () => finish(new Error("Worker command could not be started.")));
      child.once("close", (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(`Worker command exited unsuccessfully (${code ?? signal ?? "unknown"}).`));
      });
    });
  };

  const finish = (error) => {
    if (!settled) return;
    const pending = settled;
    settled = undefined;
    child = undefined;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = undefined;
    error ? pending.reject(error) : pending.resolve();
  };

  const stop = async () => {
    if (!child || !settled) return;
    const activeChild = child;
    activeChild.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      const check = () => { if (!settled || child !== activeChild) resolvePromise(); else setTimeout(check, 10); };
      check();
      stopTimer = setTimeout(() => {
        if (child === activeChild && settled) activeChild.kill("SIGKILL");
        resolvePromise();
      }, stopTimeoutMs);
    });
  };

  return { run, stop, get child() { return child; } };
}

/** Load .env.local without overriding variables explicitly supplied by the host. */
export async function loadLocalEnv(cwd = process.cwd()) {
  const envPath = resolve(cwd, ".env.local");
  try { await access(envPath, constants.F_OK); } catch { return false; }
  const supplied = { ...process.env };
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
  else {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(cwd, false);
  }
  for (const [name, value] of Object.entries(supplied)) process.env[name] = value;
  return true;
}

async function main() {
  await loadLocalEnv();
  const commandRunner = createCommandRunner();
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  console.error(`Worker scheduler started (intervalMs=${intervalMs}).`);
  const scheduler = createScheduler({
    run: async () => {
      await commandRunner.run();
      console.error("Worker run succeeded.");
    },
    stopRun: commandRunner.stop,
    intervalMs,
    onError: () => console.error("Worker run failed; the next scheduled run remains enabled."),
  }).start();
  let shuttingDown;
  const shutdown = () => {
    if (!shuttingDown) shuttingDown = scheduler.stop().then(() => process.exit(0));
    return shuttingDown;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Worker scheduler could not start."); process.exitCode = 1; });
}
