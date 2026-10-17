import { describe, expect, it } from "vitest";
import { isAllowedFilterValue, parseMintDateRange } from "@/lib/server/mint-date-range";

describe("mint date filters", () => {
  it("parses inclusive UTC date bounds", () => {
    const result = parseMintDateRange("2026-02-01", "2026-02-28");
    expect(result).toEqual({ valid: true, fromTimestamp: Date.parse("2026-02-01T00:00:00.000Z"), toTimestamp: Date.parse("2026-02-28T23:59:59.999Z") });
  });

  it("rejects impossible dates and timestamps outside the documented date-only format", () => {
    expect(parseMintDateRange("2026-02-29", null)).toMatchObject({ valid: false });
    expect(parseMintDateRange("2026-02-01T00:00:00Z", null)).toMatchObject({ valid: false });
  });

  it("rejects inverted ranges", () => {
    expect(parseMintDateRange("2026-03-02", "2026-03-01")).toMatchObject({ valid: false, error: "The from date must not be after the to date." });
  });

  it("allows only an omitted filter or a listed value", () => {
    expect(isAllowedFilterValue(null, ["live", "ended"] as const)).toBe(true);
    expect(isAllowedFilterValue("live", ["live", "ended"] as const)).toBe(true);
    expect(isAllowedFilterValue("mystery", ["live", "ended"] as const)).toBe(false);
  });
});
