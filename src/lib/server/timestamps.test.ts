import { describe, expect, it } from "vitest";
import { normalizeDatabaseTimestamp } from "@/lib/server/timestamps";

describe("normalizeDatabaseTimestamp", () => {
  it("converts Supabase timestamps with an explicit offset to canonical UTC ISO", () => {
    expect(normalizeDatabaseTimestamp("2026-10-17T00:00:00+00:00")).toBe("2026-10-17T00:00:00.000Z");
    expect(normalizeDatabaseTimestamp("2026-10-17T03:00:00+03:00")).toBe("2026-10-17T00:00:00.000Z");
  });

  it("returns null for missing or invalid database values", () => {
    expect(normalizeDatabaseTimestamp(null)).toBeNull();
    expect(normalizeDatabaseTimestamp(" ")).toBeNull();
    expect(normalizeDatabaseTimestamp("not-a-timestamp")).toBeNull();
  });
});
