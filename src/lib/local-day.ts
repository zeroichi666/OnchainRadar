export const SOCIAL_DATE_TIME_ZONE = "Asia/Jakarta";

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function dayKeyInTimeZone(value: string | null | undefined, timeZone = SOCIAL_DATE_TIME_ZONE): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function todayInTimeZone(now = new Date(), timeZone = SOCIAL_DATE_TIME_ZONE): string {
  return dayKeyInTimeZone(now.toISOString(), timeZone) ?? "";
}
