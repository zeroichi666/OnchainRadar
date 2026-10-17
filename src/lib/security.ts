import { address as solanaAddress } from "@solana/kit";
import { isAddress } from "viem";
import type { Chain, SecurityCheck, SecurityReport, SecurityVerdict, TokenCandidate } from "@/lib/domain";
import { defaultSettings, type RadarSettings } from "@/lib/settings";
export { defaultSettings } from "@/lib/settings";
export type { RadarSettings } from "@/lib/settings";

export function isValidTokenAddress(chain: Chain, value?: string | null): boolean {
  if (!value) return false;
  if (chain !== "solana") return isAddress(value);
  try {
    solanaAddress(value);
    return true;
  } catch {
    return false;
  }
}

export function getSecurityVerdict(checks: SecurityCheck[]): SecurityVerdict {
  if (!checks.length) return "UNKNOWN";
  if (checks.some((check) => check.result === "fail")) return "FAIL";
  if (!checks.some((check) => check.mandatory)) return "UNKNOWN";
  if (checks.some((check) => check.mandatory && check.result !== "pass")) return "UNKNOWN";
  if (checks.some((check) => check.result === "warning")) return "WARNING";
  return "PASS";
}

export function consolidateSecurityReports(reports: SecurityReport[]): SecurityReport | undefined {
  if (!reports.length) return undefined;
  if (reports.length === 1) return reports[0];
  const verdicts = reports.map((report) => report.verdict ?? getSecurityVerdict(report.checks));
  const uniqueVerdicts = [...new Set(verdicts)];
  const conflict = uniqueVerdicts.length > 1;
  const checks: SecurityCheck[] = reports.flatMap((report, index) => {
    const status = verdicts[index];
    const prefix = report.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const providerChecks: SecurityCheck[] = report.checks.length
      ? report.checks.map((check) => ({ ...check, id: `${prefix}:${check.id}` }))
      : [{ id: `${prefix}:missing-checks`, label: `${report.provider} returned no checks`, result: "unknown", mandatory: true }];
    if (status === "FAIL" && !providerChecks.some((check) => check.result === "fail")) providerChecks.push({ id: `${prefix}:provider-fail`, label: `${report.provider} reported FAIL`, result: "fail", mandatory: true });
    if (["PENDING", "UNKNOWN", "STALE"].includes(status) && !providerChecks.some((check) => check.mandatory && check.result !== "pass")) providerChecks.push({ id: `${prefix}:provider-incomplete`, label: `${report.provider} reported ${status}`, result: "unknown", mandatory: true });
    if (status === "WARNING" && !providerChecks.some((check) => check.result === "warning")) providerChecks.push({ id: `${prefix}:provider-warning`, label: `${report.provider} reported WARNING`, result: "warning", mandatory: false });
    return providerChecks;
  });
  const checkedAt = reports.map((report) => report.checkedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const providers = [...new Set(reports.map((report) => report.provider))].sort();
  const flags = [...new Set(reports.flatMap((report) => report.flags))];
  if (conflict) flags.push(`Conflicting provider results: ${providers.join(", ")} reported ${uniqueVerdicts.join(" vs ")}`);
  const derivedVerdict = verdicts.includes("FAIL") ? "FAIL" : verdicts.some((verdict) => ["PENDING", "UNKNOWN", "STALE"].includes(verdict)) ? "UNKNOWN" : verdicts.includes("WARNING") ? "WARNING" : getSecurityVerdict(checks);
  return { address: reports[0].address, chain: reports[0].chain, checks, checkedAt, provider: `Combined: ${providers.join(", ")}`, verdict: derivedVerdict, flags, demo: reports.every((report) => report.demo) };
}

export function isSecurityReportStale(report: SecurityReport, ttlSeconds: number, now = Date.now()): boolean {
  const checked = Date.parse(report.checkedAt);
  return !Number.isFinite(checked) || checked > now || now - checked > ttlSeconds * 1000;
}

export type GateResult = { eligible: boolean; verdict: SecurityVerdict; reasons: string[] };

export function evaluateSecurityGate(candidate: TokenCandidate, report: SecurityReport | undefined, settings: RadarSettings = defaultSettings, now = Date.now()): GateResult {
  const reasons: string[] = [];
  if (!isValidTokenAddress(candidate.chain, candidate.address)) {
    return { eligible: false, verdict: "UNKNOWN", reasons: ["Token address is missing or invalid"] };
  }
  if (!report) return { eligible: false, verdict: "PENDING", reasons: ["Security analysis is pending"] };
  if (report.chain !== candidate.chain || report.address.toLowerCase() !== candidate.address!.toLowerCase()) {
    return { eligible: false, verdict: "UNKNOWN", reasons: ["Security report does not match token chain/address"] };
  }
  if (isSecurityReportStale(report, settings.securityTtlSeconds, now)) {
    return { eligible: false, verdict: "STALE", reasons: ["Security result is stale or has an invalid timestamp"] };
  }
  const conflict = report.flags.find((flag) => flag.startsWith("Conflicting provider results:"));
  if (conflict) return { eligible: false, verdict: report.verdict ?? "UNKNOWN", reasons: [conflict, ...report.flags.filter((flag) => flag !== conflict)] };
  const derivedVerdict = getSecurityVerdict(report.checks);
  const observedVerdicts = [derivedVerdict, report.verdict ?? "PASS"];
  const verdict = (["FAIL", "STALE", "UNKNOWN", "PENDING", "WARNING", "PASS"] as const).find((item) => observedVerdicts.includes(item)) ?? "UNKNOWN";
  if (verdict === "FAIL") return { eligible: false, verdict, reasons: report.flags.length ? report.flags : ["A critical security check failed"] };
  if (!report.checks.some((check) => check.mandatory)) return { eligible: false, verdict: "UNKNOWN", reasons: ["Provider returned no mandatory security checks"] };
  if (verdict === "UNKNOWN" || verdict === "PENDING") return { eligible: false, verdict, reasons: ["One or more mandatory security checks are incomplete"] };

  const liquidity = candidate.metrics.liquidityUsd;
  const marketCap = candidate.metrics.marketCapUsd;
  if (liquidity == null || marketCap == null || marketCap <= 0) {
    return { eligible: false, verdict: "UNKNOWN", reasons: ["Liquidity or market-cap data is unavailable"] };
  }
  if (liquidity < settings.minimumLiquidityUsd) reasons.push(`Liquidity below $${settings.minimumLiquidityUsd.toLocaleString()}`);
  if ((liquidity / marketCap) * 100 < settings.minimumLiquidityToMarketCapPct) reasons.push(`Liquidity is below ${settings.minimumLiquidityToMarketCapPct}% of market cap`);
  if (reasons.length) return { eligible: false, verdict: "FAIL", reasons };

  const m = candidate.metrics;
  const optionalFilterChecks: Array<[boolean, number | null | undefined, number, string, "min" | "max"]> = [
    [settings.filters.marketCap, m.marketCapUsd, settings.minimumMarketCapUsd, "Market cap", "min"],
    [settings.filters.holderConcentration, m.top10HolderPct, settings.maximumTop10HolderPct, "Top-10 holder concentration", "max"],
    [settings.filters.developerHolding, m.developerHoldingPct, settings.maximumDeveloperHoldingPct, "Developer holding", "max"],
    [settings.filters.bundleBuy, m.bundleBuyPct, settings.maximumBundleBuyPct, "Bundle-buy indicator", "max"],
    [settings.filters.sniperConcentration, m.sniperConcentrationPct, settings.maximumSniperConcentrationPct, "Sniper concentration", "max"],
  ];
  for (const [enabled, value, threshold, label, direction] of optionalFilterChecks) {
    if (!enabled) continue;
    if (value == null) reasons.push(`${label} is unavailable while its filter is enabled`);
    else if ((direction === "min" && value < threshold) || (direction === "max" && value > threshold)) reasons.push(`${label} does not meet the configured screening threshold`);
  }
  if (settings.filters.buyerPercentage) {
    const buyers = m.buyers;
    const sellers = m.sellers;
    if (buyers == null || sellers == null || buyers + sellers === 0) reasons.push("Buyer percentage is unavailable while its filter is enabled");
    else if ((buyers / (buyers + sellers)) * 100 <= settings.minimumBuyerPct) reasons.push(`Buyer percentage is not greater than ${settings.minimumBuyerPct}%`);
  }
  return { eligible: reasons.length === 0, verdict, reasons };
}

export { scoreApprovedToken, type TokenScoreBreakdown } from "@/lib/scoring";

export function mandatoryChecksPassed(checks: SecurityCheck[]): boolean {
  return checks.some((check) => check.mandatory) && checks.filter((check) => check.mandatory).every((check) => check.result === "pass");
}
