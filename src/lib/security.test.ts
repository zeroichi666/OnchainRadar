import { describe, expect, it } from "vitest";
import { consolidateSecurityReports, defaultSettings, evaluateSecurityGate, getSecurityVerdict, isValidTokenAddress, scoreApprovedToken } from "@/lib/security";
import type { Chain, SecurityCheck, SecurityReport, TokenCandidate } from "@/lib/domain";

const now = Date.now();
const checks: SecurityCheck[] = [
  { id: "honeypot", label: "Sell simulation", result: "pass", mandatory: true },
  { id: "authority", label: "Authority controls", result: "pass", mandatory: true },
  { id: "lp", label: "Liquidity control", result: "warning", mandatory: false },
];
function candidate(overrides: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    id: "token-1", name: "Test token", symbol: "TEST", address: "0x0000000000000000000000000000000000000001", chain: "ethereum",
    metrics: { marketCapUsd: 100000, liquidityUsd: 30000, top10HolderPct: 20, developerHoldingPct: 2, bundleBuyPct: 5, sniperConcentrationPct: 2, buyers: 80, sellers: 20, volume24hUsd: 10000, poolCreatedAt: new Date(now - 2 * 3600000).toISOString() },
    discoveredAt: new Date(now - 3600000).toISOString(), sourcePosts: [], ctoStatus: "none", demo: false,
    socialMomentumScore: 70, narrativeStrengthScore: 60, ...overrides,
  };
}
function report(overrides: Partial<SecurityReport> = {}): SecurityReport {
  return { address: "0x0000000000000000000000000000000000000001", chain: "ethereum", checks, checkedAt: new Date(now - 1000).toISOString(), provider: "test-provider", flags: [], demo: false, ...overrides };
}

describe("address validation", () => {
  it("accepts valid EVM and Solana addresses and rejects malformed values", () => {
    expect(isValidTokenAddress("ethereum", "0x0000000000000000000000000000000000000001")).toBe(true);
    expect(isValidTokenAddress("ethereum", "not-an-address")).toBe(false);
    expect(isValidTokenAddress("solana", "So11111111111111111111111111111111111111112")).toBe(true);
    expect(isValidTokenAddress("solana", "invalid!!!")).toBe(false);
  });
});

describe("security gate", () => {
  it("allows only current reports with mandatory checks passed and sufficient liquidity", () => {
    expect(evaluateSecurityGate(candidate(), report(), defaultSettings, now)).toMatchObject({ eligible: true, verdict: "WARNING" });
  });
  it("keeps missing, invalid-address, or incomplete analysis out of the main feed", () => {
    expect(evaluateSecurityGate(candidate({ address: null }), report(), defaultSettings, now).eligible).toBe(false);
    expect(evaluateSecurityGate(candidate(), undefined, defaultSettings, now).verdict).toBe("PENDING");
    expect(evaluateSecurityGate(candidate(), report({ checks: [{ id: "sell", label: "Sell", result: "unknown", mandatory: true }] }), defaultSettings, now).verdict).toBe("UNKNOWN");
  });
  it("hard-fails critical checks and stale provider results", () => {
    expect(evaluateSecurityGate(candidate(), report({ checks: [{ id: "honeypot", label: "Honeypot", result: "fail", mandatory: true }] }), defaultSettings, now).verdict).toBe("FAIL");
    expect(evaluateSecurityGate(candidate(), report({ checkedAt: new Date(now - 901000).toISOString() }), defaultSettings, now).verdict).toBe("STALE");
  });
  it("does not let toggles disable mandatory security checks", () => {
    const settings = { ...defaultSettings, filters: { marketCap: false, holderConcentration: false, developerHolding: false, bundleBuy: false, sniperConcentration: false, buyerPercentage: false } };
    const failed = report({ checks: [{ id: "sell", label: "Sell", result: "fail", mandatory: true }] });
    expect(evaluateSecurityGate(candidate(), failed, settings, now).eligible).toBe(false);
  });
  it("fails closed on missing values for enabled non-critical screening filters", () => {
    const noHolderData = candidate({ metrics: { marketCapUsd: 100000, liquidityUsd: 30000, buyers: 80, sellers: 20 } });
    expect(evaluateSecurityGate(noHolderData, report(), defaultSettings, now).eligible).toBe(false);
  });
  it("derives verdict from checks rather than trusting a supplied display status", () => {
    expect(getSecurityVerdict([{ id: "mint", label: "Mint authority", result: "pass", mandatory: true }, { id: "owner", label: "Owner", result: "warning", mandatory: false }])).toBe("WARNING");
  });
  it("fails closed when a provider supplies no mandatory checks", () => {
    const incomplete = report({ checks: [{ id: "lp", label: "Liquidity", result: "pass", mandatory: false }] });
    expect(evaluateSecurityGate(candidate(), incomplete, defaultSettings, now)).toMatchObject({ eligible: false, verdict: "UNKNOWN" });
    expect(getSecurityVerdict(incomplete.checks)).toBe("UNKNOWN");
  });
  it("never downgrades an explicit fail finding because the provider marked it optional", () => {
    const failed = report({ checks: [{ id: "sell", label: "Sell restriction", result: "fail", mandatory: false }] });
    expect(getSecurityVerdict(failed.checks)).toBe("FAIL");
    expect(evaluateSecurityGate(candidate(), failed, defaultSettings, now).verdict).toBe("FAIL");
  });
  it("keeps provider disagreements out of the primary feed and combines checks conservatively", () => {
    const passing = report({ provider: "Provider A" });
    const failing = report({ provider: "Provider B", checks: [{ id: "sell", label: "Sell simulation", result: "fail", mandatory: true }], verdict: "FAIL", flags: ["Sell simulation failed"] });
    const combined = consolidateSecurityReports([passing, failing])!;
    expect(combined.flags.some((flag) => flag.startsWith("Conflicting provider results:"))).toBe(true);
    expect(evaluateSecurityGate(candidate(), combined, defaultSettings, now)).toMatchObject({ eligible: false, verdict: "FAIL" });
  });
});

describe("transparent score", () => {
  it("computes a bounded weighted score and normalizes over available metrics", () => {
    const score = scoreApprovedToken(candidate(), now);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.earlyDiscovery).toBe(100);
    expect(scoreApprovedToken(candidate({ metrics: {} }), now).total).toBe(65);
    expect(scoreApprovedToken(candidate({ metrics: {}, socialMomentumScore: null, narrativeStrengthScore: null }), now).total).toBeNull();
  });
});
