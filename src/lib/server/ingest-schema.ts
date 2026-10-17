import { z } from "zod";
import { GtdOpportunitySchema, NarrativeSchema, NftOpportunitySchema, TokenCandidateSchema } from "@/lib/domain";

const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((row) => row.id)).size === rows.length;
const IngestedTokenSchema = TokenCandidateSchema.extend({ metrics: z.object({}).strict().optional() });
export const IngestionEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(8).max(120),
  source: z.literal("agent-reach"),
  syncedAt: z.string().datetime(),
  nfts: z.array(NftOpportunitySchema).max(200),
  gtd: z.array(GtdOpportunitySchema).max(200),
  tokens: z.array(IngestedTokenSchema).max(200),
  narratives: z.array(NarrativeSchema).max(100),
}).strict().superRefine((value, ctx) => {
  if (!uniqueIds(value.nfts)) ctx.addIssue({ code: "custom", message: "Duplicate id found in nfts", path: ["nfts"] });
  if (!uniqueIds(value.gtd)) ctx.addIssue({ code: "custom", message: "Duplicate id found in gtd", path: ["gtd"] });
  if (!uniqueIds(value.tokens)) ctx.addIssue({ code: "custom", message: "Duplicate id found in tokens", path: ["tokens"] });
  if (!uniqueIds(value.narratives)) ctx.addIssue({ code: "custom", message: "Duplicate id found in narratives", path: ["narratives"] });
  if (value.nfts.some((row) => row.demo)) ctx.addIssue({ code: "custom", message: "Demo records are not accepted by live ingestion", path: ["nfts"] });
  if (value.gtd.some((row) => row.demo)) ctx.addIssue({ code: "custom", message: "Demo records are not accepted by live ingestion", path: ["gtd"] });
  if (value.tokens.some((row) => row.demo)) ctx.addIssue({ code: "custom", message: "Demo records are not accepted by live ingestion", path: ["tokens"] });
  if (value.narratives.some((row) => row.demo)) ctx.addIssue({ code: "custom", message: "Demo records are not accepted by live ingestion", path: ["narratives"] });
});
export type IngestionEnvelope = z.infer<typeof IngestionEnvelopeSchema>;
