import { address as solanaAddress } from "@solana/kit";
import type { SecurityCheck, SecurityReport } from "@/lib/domain";
import { getSecurityVerdict } from "@/lib/security";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

type RpcMint = { owner?: unknown; data?: unknown; executable?: unknown };
function unknownReport(mint: string, checkedAt: string, detail: string): SecurityReport {
  return { address: mint, chain: "solana", checkedAt, provider: "Solana JSON-RPC (partial on-chain checks)", flags: [detail], demo: false, checks: [
    { id: "rpc-mint-analysis", label: "Solana mint analysis", result: "unknown", mandatory: true, detail },
    { id: "holder-concentration", label: "Holder concentration", result: "unknown", mandatory: true, detail: "No reliable owner-aggregated holder data was available" },
  ], verdict: "UNKNOWN" };
}

export function parseSolanaMintAccount(mint: string, account: RpcMint | null, checkedAt = new Date().toISOString()): SecurityReport {
  if (!account || typeof account.owner !== "string" || !Array.isArray(account.data) || typeof account.data[0] !== "string") {
    return unknownReport(mint, checkedAt, "Mint account or binary account data unavailable");
  }
  let bytes: Buffer;
  try { bytes = Buffer.from(account.data[0], "base64"); } catch { return unknownReport(mint, checkedAt, "Mint account data could not be decoded"); }
  const isLegacy = account.owner === TOKEN_PROGRAM;
  const is2022 = account.owner === TOKEN_2022_PROGRAM;
  if (!isLegacy && !is2022) return {
    address: mint, chain: "solana", checkedAt, provider: "Solana JSON-RPC (partial on-chain checks)", flags: ["Mint account is not owned by a recognized SPL Token program"], demo: false,
    checks: [{ id: "token-program", label: "Recognized token program", result: "fail", mandatory: true }], verdict: "FAIL",
  };
  if (bytes.length < 82) return unknownReport(mint, checkedAt, "Mint account data is shorter than the SPL Token mint layout");
  const mintAuthorityOption = bytes.readUInt32LE(0);
  const freezeAuthorityOption = bytes.readUInt32LE(46);
  const mintAuthorityActive = mintAuthorityOption !== 0;
  const freezeAuthorityActive = freezeAuthorityOption !== 0;
  const checks: SecurityCheck[] = [
    { id: "token-program", label: "Recognized SPL Token program", result: "pass", mandatory: true },
    { id: "mint-layout", label: "SPL mint account layout", result: bytes[45] === 1 ? "pass" : "fail", mandatory: true },
    { id: "mint-authority", label: "Mint authority", result: mintAuthorityActive ? "warning" : "pass", mandatory: false, ...(mintAuthorityActive ? { detail: "An active mint authority can change supply" } : {}) },
    { id: "freeze-authority", label: "Freeze authority", result: freezeAuthorityActive ? "warning" : "pass", mandatory: false, ...(freezeAuthorityActive ? { detail: "An active freeze authority can freeze token accounts" } : {}) },
    { id: "token-extensions", label: "Token-2022 extension review", result: isLegacy ? "pass" : "unknown", mandatory: true, ...(is2022 ? { detail: "Token-2022 extension bytes are not decoded by this adapter" } : {}) },
    { id: "holder-concentration", label: "Holder concentration", result: "unknown", mandatory: true, detail: "Owner-aggregated holder distribution is not available from this RPC-only adapter" },
  ];
  const flags = [
    ...(mintAuthorityActive ? ["Mint authority remains active"] : []),
    ...(freezeAuthorityActive ? ["Freeze authority remains active"] : []),
    ...(is2022 ? ["Token-2022 extensions remain unreviewed"] : []),
    "Holder concentration is unavailable; token remains outside the primary feed",
  ];
  return { address: mint, chain: "solana", checkedAt, provider: "Solana JSON-RPC (partial on-chain checks)", checks, flags, demo: false, verdict: getSecurityVerdict(checks) };
}

export async function fetchSolanaSecurity(mint: string, fetcher: typeof fetch = fetch): Promise<SecurityReport> {
  const checkedAt = new Date().toISOString();
  const rpc = process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL;
  try { solanaAddress(mint); } catch { return { address: mint, chain: "solana", checkedAt, provider: "Solana JSON-RPC", flags: ["Invalid mint address"], demo: false, checks: [{ id: "mint-address", label: "Mint address validation", result: "fail", mandatory: true }], verdict: "FAIL" }; }
  try {
    const response = await fetcher(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "base64", commitment: "finalized" }] }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}`);
    const json = await response.json() as { result?: { value?: RpcMint | null }; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message || "Solana RPC error");
    return parseSolanaMintAccount(mint, json.result?.value ?? null, checkedAt);
  } catch {
    return unknownReport(mint, checkedAt, "Solana RPC unavailable; token is not eligible for the primary feed");
  }
}
