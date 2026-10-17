import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentJakartaDate, getJakartaDayWindow, tweetIsInJakartaDay } from "./search-window.mjs";

describe("Asia/Jakarta search-day window", () => {
  it("defaults to today's date in WIB, not the machine's UTC date", () => {
    assert.equal(currentJakartaDate(new Date("2026-10-17T16:30:00.000Z")), "2026-10-17");
    assert.equal(currentJakartaDate(new Date("2026-10-17T17:00:00.000Z")), "2026-10-18");
  });

  it("uses a half-open exact WIB day and a broad UTC date-only X query boundary", () => {
    const window = getJakartaDayWindow("2026-10-17");
    assert.equal(new Date(window.fromTimestamp).toISOString(), "2026-10-16T17:00:00.000Z");
    assert.equal(new Date(window.toTimestamp).toISOString(), "2026-10-17T17:00:00.000Z");
    assert.equal(window.querySince, "2026-10-16");
    assert.equal(window.queryUntil, "2026-10-18");
    assert.equal(tweetIsInJakartaDay({ createdAt: "2026-10-16T16:59:59.999Z" }, window), false);
    assert.equal(tweetIsInJakartaDay({ createdAt: "2026-10-16T17:00:00.000Z" }, window), true);
    assert.equal(tweetIsInJakartaDay({ createdAt: "2026-10-17T16:59:59.999Z" }, window), true);
    assert.equal(tweetIsInJakartaDay({ createdAt: "2026-10-17T17:00:00.000Z" }, window), false);
    assert.equal(tweetIsInJakartaDay({ text: "missing source timestamp" }, window), false);
  });

  it("rejects impossible or non-date search boundaries", () => {
    assert.throws(() => getJakartaDayWindow("2026-02-29"), /valid YYYY-MM-DD/);
    assert.throws(() => getJakartaDayWindow("2026-10-17T00:00:00Z"), /valid YYYY-MM-DD/);
  });
});
