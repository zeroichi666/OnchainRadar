import { describe, expect, it } from "vitest";
import { dayKeyInTimeZone, isValidDateOnly, todayInTimeZone } from "@/lib/local-day";

describe("social post day in Asia/Jakarta", () => {
  it("assigns posts by their WIB calendar date across the UTC boundary", () => {
    expect(dayKeyInTimeZone("2026-10-16T16:59:59.999Z")).toBe("2026-10-16");
    expect(dayKeyInTimeZone("2026-10-16T17:00:00.000Z")).toBe("2026-10-17");
    expect(dayKeyInTimeZone("2026-10-17T16:59:59.999Z")).toBe("2026-10-17");
    expect(dayKeyInTimeZone("2026-10-17T17:00:00.000Z")).toBe("2026-10-18");
  });

  it("uses the configured timezone for today's date and rejects invalid timestamps", () => {
    expect(todayInTimeZone(new Date("2026-10-17T16:59:00.000Z"))).toBe("2026-10-17");
    expect(dayKeyInTimeZone("not-a-timestamp")).toBeNull();
    expect(isValidDateOnly("2026-10-17")).toBe(true);
    expect(isValidDateOnly("2026-02-29")).toBe(false);
    expect(isValidDateOnly("2026-10-17T00:00:00Z")).toBe(false);
  });
});
