import { z } from "zod";

export const FilterTogglesSchema = z.object({
  marketCap: z.boolean(),
  holderConcentration: z.boolean(),
  developerHolding: z.boolean(),
  bundleBuy: z.boolean(),
  sniperConcentration: z.boolean(),
  buyerPercentage: z.boolean(),
}).strict();

export const RadarClientSettingsSchema = z.object({
  minimumLiquidityUsd: z.number().min(1).max(1_000_000_000),
  lowCostMintThresholdUsd: z.number().min(0).max(100_000),
  minimumMarketCapUsd: z.number().min(0).max(1_000_000_000_000),
  minimumLiquidityToMarketCapPct: z.number().min(1).max(100),
  maximumTop10HolderPct: z.number().min(0).max(100),
  maximumDeveloperHoldingPct: z.number().min(0).max(100),
  maximumBundleBuyPct: z.number().min(0).max(100),
  maximumSniperConcentrationPct: z.number().min(0).max(100),
  minimumBuyerPct: z.number().min(0).max(100),
  filters: FilterTogglesSchema,
}).strict();
export type RadarClientSettings = z.infer<typeof RadarClientSettingsSchema>;
export type RadarSettings = RadarClientSettings & { securityTtlSeconds: number };

export const defaultClientSettings: RadarClientSettings = {
  minimumLiquidityUsd: 5000,
  lowCostMintThresholdUsd: 5,
  minimumMarketCapUsd: 50000,
  minimumLiquidityToMarketCapPct: 20,
  maximumTop10HolderPct: 25,
  maximumDeveloperHoldingPct: 5,
  maximumBundleBuyPct: 20,
  maximumSniperConcentrationPct: 5,
  minimumBuyerPct: 65,
  filters: { marketCap: true, holderConcentration: true, developerHolding: true, bundleBuy: true, sniperConcentration: true, buyerPercentage: true },
};

export const defaultSettings: RadarSettings = { ...defaultClientSettings, securityTtlSeconds: 900 };
