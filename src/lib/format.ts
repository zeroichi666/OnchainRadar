export function formatUsd(value?: number | null, maximumFractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard" }).format(value);
}
export function formatNumber(value?: number | null, maximumFractionDigits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard" }).format(value);
}
export function formatPercent(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
export function shortAddress(value?: string | null): string {
  if (!value) return "Address unreported";
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}
export function chainLabel(chain: string): string {
  const labels: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", bsc: "BNB Chain" };
  return labels[chain] ?? chain;
}
export function timeAgo(value?: string | null): string {
  if (!value) return "Not synced";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Time unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function formatDate(value?: string | null): string {
  if (!value) return "Not reported";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Time unknown";
}
