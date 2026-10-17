import { describe, expect, it } from "vitest";
import { DashboardPayloadSchema } from "@/lib/domain";
import { getDemoDashboard } from "@/lib/demo";
import { IngestionEnvelopeSchema } from "@/lib/server/ingest-schema";

const emptyEnvelope = { schemaVersion: 1 as const, eventId: "agent-reach-batch-001", source: "agent-reach" as const, syncedAt: new Date().toISOString(), nfts: [], gtd: [], tokens: [], narratives: [] };

describe("dashboard demo contract", () => {
  it("validates explicitly fictional data without presenting mock tokens as approved", () => {
    const parsed = DashboardPayloadSchema.parse(getDemoDashboard());
    expect(parsed.mode).toBe("demo");
    expect(parsed.tokens).toHaveLength(0);
    expect(parsed.securityQueue[0].verdict).toBe("PENDING");
    expect(parsed.warnings[0]).toContain("fictional placeholders");
  });
});

describe("Agent-Reach ingestion envelope", () => {
  it("accepts an empty but correctly versioned normalized batch", () => {
    expect(IngestionEnvelopeSchema.safeParse(emptyEnvelope).success).toBe(true);
  });
  it("rejects demo records and duplicated entity identifiers", () => {
    const demo = getDemoDashboard().nfts[0];
    expect(IngestionEnvelopeSchema.safeParse({ ...emptyEnvelope, nfts: [demo] }).success).toBe(false);
    const duplicate = { id: "same", name: "Synthetic", chain: "base", sourcePosts: [], discoveredAt: new Date().toISOString(), status: "unverified", kind: "unknown", securityStatus: "pending", confidence: 0, demo: false };
    expect(IngestionEnvelopeSchema.safeParse({ ...emptyEnvelope, nfts: [duplicate, duplicate] }).success).toBe(false);
  });
  it("rejects worker-supplied token market metrics used by screening gates", () => {
    const candidate = { id: "candidate-1", name: "Unverified claim", symbol: "CLAIM", address: "0x0000000000000000000000000000000000000001", chain: "ethereum", metrics: { marketCapUsd: 100000, liquidityUsd: 50000, top10HolderPct: 10, buyers: 100, sellers: 1 }, discoveredAt: new Date().toISOString(), sourcePosts: [], demo: false };
    expect(IngestionEnvelopeSchema.safeParse({ ...emptyEnvelope, tokens: [candidate] }).success).toBe(false);
    expect(IngestionEnvelopeSchema.safeParse({ ...emptyEnvelope, tokens: [{ ...candidate, metrics: {} }] }).success).toBe(true);
  });
});
