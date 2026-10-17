export type MintDateRange = {
  valid: true;
  fromTimestamp: number | null;
  toTimestamp: number | null;
};

export type InvalidMintDateRange = {
  valid: false;
  error: string;
};

function parseUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

export function parseMintDateRange(from: string | null, to: string | null): MintDateRange | InvalidMintDateRange {
  const fromTimestamp = from === null ? null : parseUtcDate(from);
  const toStartTimestamp = to === null ? null : parseUtcDate(to);
  if ((from !== null && fromTimestamp === null) || (to !== null && toStartTimestamp === null)) {
    return { valid: false, error: "Date filters must use valid YYYY-MM-DD dates." };
  }
  if (fromTimestamp !== null && toStartTimestamp !== null && fromTimestamp > toStartTimestamp) {
    return { valid: false, error: "The from date must not be after the to date." };
  }
  return {
    valid: true,
    fromTimestamp,
    toTimestamp: toStartTimestamp === null ? null : toStartTimestamp + 86_399_999,
  };
}

export function isAllowedFilterValue<T extends string>(value: string | null, allowed: readonly T[]): value is T | null {
  return value === null || allowed.includes(value as T);
}
