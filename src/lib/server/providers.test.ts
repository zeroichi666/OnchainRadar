import { beforeEach, describe, expect, it } from "vitest";
import { mergeDexPair, selectBestPair, fetchDexPairs, enrichCandidateBatch } from "@/lib/server/dexscreener";
import { fetchGoPlusSecurity, mapGoPlusTokenSecurity } from "@/lib/server/goplus";
import { parseSolanaMintAccount, fetchSolanaSecurity, DEFAULT_SOLANA_RPC_URL } from "@/lib/server/solana-security";
import type { TokenCandidate } from "@/lib/domain";

const candidate: TokenCandidate = { id: "x", name: "Unlabeled", symbol: "UNK", address: "0x0000000000000000000000000000000000000001", chain: "ethereum", metrics: {}, discoveredAt: new Date().toISOString(), sourcePosts: [], ctoStatus: "none", demo: false };
const basePair = { chainId: "ethereum", dexId: "testdex", url: "https://dex.example/pair", pairAddress: "0xpool", baseToken: { address: candidate.address!, name: "Token A", symbol: "TKA" }, quoteToken: { address: "0x0000000000000000000000000000000000000002", name: "USD", symbol: "USD" }, priceUsd: "0.12", txns: { h24: { buys: 20, sells: 10 } }, volume: { h24: 50000 }, priceChange: { h1: 2 }, liquidity: { usd: 20000 }, fdv: 150000, marketCap: 100000, pairCreatedAt: 1_700_000_000_000, info: { imageUrl: "https://cdn.example/token.png" } };

beforeEach(() => { /* provider cache keys are unique per test */ });

describe("DexScreener adapter", () => {
  it("selects the deepest pair for the requested token and maps documented fields", () => {
    const shallow = { ...basePair, liquidity: { usd: 100 } };
    const selected = selectBestPair([shallow, basePair], candidate.address!);
    expect(selected?.liquidity?.usd).toBe(20000);
    const enriched = mergeDexPair(candidate, selected!);
    expect(enriched).toMatchObject({ name: "Token A", symbol: "TKA", metrics: { priceUsd: 0.12, marketCapUsd: 100000, liquidityUsd: 20000, buys24h: 20, sells24h: 10 } });
  });
  it("rejects malformed provider payloads and validates query batching", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/tokens/v1/ethereum/");
      return new Response(JSON.stringify([basePair]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    expect((await fetchDexPairs("ethereum", [candidate.address!], fetcher, Date.now() + 50_000)).length).toBe(1);
  });
  it("does not retry a permanent DEX client error", async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return new Response("bad request", { status: 400 }); }) as typeof fetch;
    await expect(fetchDexPairs("base", ["0x0000000000000000000000000000000000000003"], fetcher)).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
  });
  it("ignores a provider pair whose chain does not match the requested chain", async () => {
    const requested = { ...candidate, id: "chain-check", address: "0x0000000000000000000000000000000000000004", metrics: {} };
    const mismatched = { ...basePair, chainId: "base", baseToken: { ...basePair.baseToken, address: requested.address! } };
    const fetcher = (async () => new Response(JSON.stringify([mismatched]), { status: 200 })) as typeof fetch;
    const result = await enrichCandidateBatch([requested], fetcher);
    expect(result.candidates[0].metrics.marketCapUsd).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/chain-matching pairs/i);
  });
});

describe("GoPlus adapter", () => {
  it("maps mandatory risk signals and does not infer safe results from missing data", () => {
    const unknown = mapGoPlusTokenSecurity("ethereum", candidate.address!, { is_honeypot: "0" });
    expect(unknown.verdict).toBe("UNKNOWN");
    expect(unknown.checks.some((item) => item.result === "unknown" && item.mandatory)).toBe(true);
  });
  it("fails on honeypot indicators and warns for non-critical privileges", () => {
    const failed = mapGoPlusTokenSecurity("ethereum", candidate.address!, { is_honeypot: "1", cannot_sell_all: "0", is_blacklisted: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0", is_mintable: "1", can_take_back_ownership: "0", hidden_owner: "0", is_proxy: "0", transfer_pausable: "0", slippage_modifiable: "0" });
    expect(failed.verdict).toBe("FAIL");
    expect(failed.flags).toContain("Honeypot indicator reported by GoPlus");
  });
  it("does not reuse a GoPlus record for a different contract address", async () => {
    const otherAddress = "0x0000000000000000000000000000000000000002";
    const fetcher = (async () => new Response(JSON.stringify({ code: 1, result: { [otherAddress]: { is_honeypot: "0", cannot_sell_all: "0", is_blacklisted: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" } } }), { status: 200 })) as typeof fetch;
    const result = await fetchGoPlusSecurity("ethereum", candidate.address!, fetcher);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.flags.join(" ")).toMatch(/unavailable/i);
  });
});

describe("Solana RPC adapter", () => {
  it("marks unsupported or missing data as unknown and never passes partial analysis", () => {
    expect(parseSolanaMintAccount("So11111111111111111111111111111111111111112", null).verdict).toBe("UNKNOWN");
  });
  it("identifies active authority and leaves holder concentration unverified", () => {
    const bytes = Buffer.alloc(82);
    bytes.writeUInt32LE(1, 0);
    bytes[45] = 1;
    bytes.writeUInt32LE(0, 46);
    const parsed = parseSolanaMintAccount("So11111111111111111111111111111111111111112", { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: [bytes.toString("base64"), "base64"] });
    expect(parsed.verdict).toBe("UNKNOWN");
    expect(parsed.flags).toContain("Mint authority remains active");
    expect(parsed.checks.find((item) => item.id === "holder-concentration")?.result).toBe("unknown");
  });
  it("uses the documented public mainnet RPC fallback when no private URL is configured", async () => {
    const original = process.env.SOLANA_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
    const fetcher = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(DEFAULT_SOLANA_RPC_URL);
      return new Response(JSON.stringify({ result: { value: null } }), { status: 200 });
    }) as typeof fetch;
    try {
      expect((await fetchSolanaSecurity("So11111111111111111111111111111111111111112", fetcher)).verdict).toBe("UNKNOWN");
    } finally {
      if (original === undefined) delete process.env.SOLANA_RPC_URL; else process.env.SOLANA_RPC_URL = original;
    }
  });
});
