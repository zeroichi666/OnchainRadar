import type { Chain, SecurityCheck, SecurityReport } from "@/lib/domain";
import { getSecurityVerdict } from "@/lib/security";

const chainIds: Partial<Record<Chain, string>> = { ethereum: "1", optimism: "10", bsc: "56", polygon: "137", arbitrum: "42161", base: "8453" };
type GoPlusToken = Record<string, unknown>;

function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) { const n = Number(value); return Number.isFinite(n) ? n : null; }
  return null;
}
function check(id: string, label: string, value: boolean | null, mandatory = true, trueIsFail = false): SecurityCheck {
  return { id, label, mandatory, result: value == null ? "unknown" : value === true && trueIsFail ? "fail" : value === true ? "pass" : "pass" };
}

export function mapGoPlusTokenSecurity(chain: Chain, tokenAddress: string, payload: GoPlusToken | null, checkedAt = new Date().toISOString()): SecurityReport {
  if (!payload) return {
    address: tokenAddress, chain, checkedAt, provider: "GoPlus Security API", checks: [
      { id: "provider-response", label: "Provider security response", result: "unknown", mandatory: true, detail: "No validated token record was returned" },
    ], flags: ["GoPlus result unavailable; token is not eligible for the primary feed"], demo: false, verdict: "UNKNOWN",
  };
  const checks: SecurityCheck[] = [];
  const flags: string[] = [];
  const honeypot = flag(payload.is_honeypot);
  checks.push(check("honeypot", "Honeypot indicator", honeypot, true, true));
  if (honeypot === true) flags.push("Honeypot indicator reported by GoPlus");

  const sellBlocked = flag(payload.cannot_sell_all);
  checks.push(check("sellability", "Sellability indicator", sellBlocked, true, true));
  if (sellBlocked === true) flags.push("Sell-all restriction reported");

  const blacklisted = flag(payload.is_blacklisted);
  checks.push(check("blacklist", "Blacklist control", blacklisted, true, true));
  if (blacklisted === true) flags.push("Blacklist control reported");

  const verified = flag(payload.is_open_source);
  checks.push({ id: "source-verification", label: "Contract source verification", result: verified == null ? "unknown" : verified ? "pass" : "fail", mandatory: true, ...(verified === false ? { detail: "Contract source is not verified by the provider" } : {}) });
  if (verified === false) flags.push("Contract source is not verified");

  const buyTax = numberValue(payload.buy_tax);
  const sellTax = numberValue(payload.sell_tax);
  const taxKnown = buyTax != null && sellTax != null;
  const maxTax = Math.max(buyTax ?? 0, sellTax ?? 0);
  checks.push({ id: "taxes", label: "Buy/sell tax data", result: !taxKnown ? "unknown" : maxTax >= 50 ? "fail" : maxTax > 10 ? "warning" : "pass", mandatory: true, ...(taxKnown ? { detail: `Buy ${buyTax}%, sell ${sellTax}%` } : {}) });
  if (taxKnown && maxTax > 10) flags.push(`High transfer tax reported (buy ${buyTax}%, sell ${sellTax}%)`);

  const privilegeFields: Array<[string, string]> = [["is_mintable", "Additional minting privilege"], ["can_take_back_ownership", "Ownership recovery privilege"], ["hidden_owner", "Hidden owner privilege"], ["is_proxy", "Proxy/upgradeability"], ["transfer_pausable", "Transfer pause privilege"], ["slippage_modifiable", "Fee modification privilege"]];
  for (const [key, label] of privilegeFields) {
    const active = flag(payload[key]);
    if (active === true) flags.push(`${label} reported`);
    checks.push({ id: key, label, result: active == null ? "unknown" : active ? "warning" : "pass", mandatory: false });
  }
  return { address: tokenAddress, chain, checks, checkedAt, provider: "GoPlus Security API", flags, demo: false, verdict: getSecurityVerdict(checks) };
}

export async function fetchGoPlusSecurity(chain: Chain, tokenAddress: string, fetcher: typeof fetch = fetch): Promise<SecurityReport> {
  const chainId = chainIds[chain];
  const checkedAt = new Date().toISOString();
  if (!chainId) return mapGoPlusTokenSecurity(chain, tokenAddress, null, checkedAt);
  const url = new URL(`https://api.gopluslabs.io/api/v1/token_security/${chainId}`);
  url.searchParams.set("contract_addresses", tokenAddress);
  const headers: HeadersInit = { accept: "application/json" };
  const accessToken = process.env.GOPLUS_ACCESS_TOKEN;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) throw new Error(`GoPlus returned HTTP ${response.status}`);
    const json = await response.json() as { code?: number; result?: Record<string, GoPlusToken> };
    if (json.code !== 1 || !json.result) return mapGoPlusTokenSecurity(chain, tokenAddress, null, checkedAt);
    const token = Object.entries(json.result).find(([address]) => address.toLowerCase() === tokenAddress.toLowerCase())?.[1];
    return mapGoPlusTokenSecurity(chain, tokenAddress, token ?? null, checkedAt);
  } catch {
    return mapGoPlusTokenSecurity(chain, tokenAddress, null, checkedAt);
  }
}
