export function normalizeDatabaseTimestamp(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
