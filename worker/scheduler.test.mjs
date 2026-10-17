import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCommandRunner, createScheduler, DEFAULT_INTERVAL_MS } from "./scheduler.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeClock() {
  let callback;
  let delay;
  let cleared = false;
  return {
    setInterval(fn, ms) { callback = fn; delay = ms; return 7; },
    clearInterval(id) { assert.equal(id, 7); cleared = true; },
    fire() { callback?.(); },
    get delay() { return delay; },
    get cleared() { return cleared; },
  };
}

describe("application-native worker scheduler", () => {
  it("uses the ten-minute default interval", async () => {
    const clock = fakeClock();
    const scheduler = createScheduler({ run: async () => {}, setIntervalFn: clock.setInterval, clearIntervalFn: clock.clearInterval });
    scheduler.start();
    await flush();
    assert.equal(clock.delay, DEFAULT_INTERVAL_MS);
    await scheduler.stop();
  });

  it("cannot start after it has been stopped", async () => {
    const clock = fakeClock();
    let calls = 0;
    const scheduler = createScheduler({ run: () => { calls += 1; }, setIntervalFn: clock.setInterval, clearIntervalFn: clock.clearInterval });
    await scheduler.stop();
    scheduler.start();
    await flush();
    assert.equal(calls, 0);
  });
  it("continues on the normal interval after a failed run", async () => {
    const clock = fakeClock();
    let attempts = 0;
    const errors = [];
    const scheduler = createScheduler({
      run: async () => { attempts += 1; if (attempts === 1) throw new Error("mock failure"); },
      setIntervalFn: clock.setInterval,
      clearIntervalFn: clock.clearInterval,
      onError: (error) => errors.push(error.message),
    }).start();
    await flush();
    assert.equal(attempts, 1);
    clock.fire();
    await flush();
    assert.equal(attempts, 2);
    assert.deepEqual(errors, ["mock failure"]);
    assert.equal(clock.delay, DEFAULT_INTERVAL_MS);
    await scheduler.stop();
  });

  it("does not overlap a slow run", async () => {
    const clock = fakeClock();
    let calls = 0;
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const scheduler = createScheduler({ run: async () => { calls += 1; await blocked; }, setIntervalFn: clock.setInterval, clearIntervalFn: clock.clearInterval }).start();
    await flush();
    clock.fire();
    clock.fire();
    await flush();
    assert.equal(calls, 1);
    release();
    await scheduler.stop();
  });

  it("stops scheduling and waits for the active run", async () => {
    const clock = fakeClock();
    let release;
    const active = new Promise((resolve) => { release = resolve; });
    let stopped = false;
    const scheduler = createScheduler({ run: () => active, stopRun: async () => { stopped = true; release(); }, setIntervalFn: clock.setInterval, clearIntervalFn: clock.clearInterval }).start();
    await flush();
    await scheduler.stop();
    assert.equal(stopped, true);
    assert.equal(clock.cleared, true);
    assert.equal(scheduler.running, false);
  });

  it("stops a command spawned by the pending first tick", async () => {
    const child = new EventEmitter();
    child.killSignals = [];
    child.kill = (signal) => { child.killSignals.push(signal); queueMicrotask(() => child.emit("close", null, signal)); return true; };
    const runner = createCommandRunner({ spawnFn: () => child, stopTimeoutMs: 100 });
    const scheduler = createScheduler({ run: runner.run, stopRun: runner.stop, setIntervalFn: () => 1, clearIntervalFn: () => {} }).start();
    await scheduler.stop();
    assert.deepEqual(child.killSignals, ["SIGTERM"]);
  });

  it("shuts down a running command with SIGTERM", async () => {
    const child = new EventEmitter();
    child.killSignals = [];
    child.kill = (signal) => { child.killSignals.push(signal); queueMicrotask(() => child.emit("close", null, signal)); return true; };
    const runner = createCommandRunner({ spawnFn: () => child, stopTimeoutMs: 100 });
    const pending = runner.run();
    const expectedFailure = assert.rejects(pending, /unsuccessfully/);
    await runner.stop();
    await expectedFailure;
    assert.deepEqual(child.killSignals, ["SIGTERM"]);
  });
});
