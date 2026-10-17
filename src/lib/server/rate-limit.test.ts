import { afterEach, describe, expect, it } from "vitest";
import { allowRateLimit, clearRateLimitsForTests, getClientIp } from "@/lib/server/rate-limit";

afterEach(() => clearRateLimitsForTests());

describe("ingestion rate limiter", () => {
  it("allows the configured request count and resets after the window", () => {
    expect(allowRateLimit("ip", 2, 1000, 10_000)).toBe(true);
    expect(allowRateLimit("ip", 2, 1000, 10_100)).toBe(true);
    expect(allowRateLimit("ip", 2, 1000, 10_200)).toBe(false);
    expect(allowRateLimit("ip", 2, 1000, 11_001)).toBe(true);
  });
  it("prefers the Netlify client IP header over forwarded values", () => {
    expect(getClientIp(new Headers({ "x-nf-client-connection-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.2" }))).toBe("192.0.2.1");
    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.3, 198.51.100.4" }))).toBe("198.51.100.3");
    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.99" }), false)).toBe("unknown");
  });
});
