export const SEARCH_TIME_ZONE = "Asia/Jakarta";
const DAY_MS = 86_400_000;

function dateKeyInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function addUtcDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function currentJakartaDate(now = new Date()) {
  return dateKeyInZone(now, SEARCH_TIME_ZONE);
}

export function getJakartaDayWindow(selectedDate, now = new Date()) {
  const day = selectedDate ?? currentJakartaDate(now);
  if (parseDateOnly(day) === null) throw new Error("AGENT_REACH_SEARCH_DATE must be a valid YYYY-MM-DD date.");

  // Jakarta is UTC+07:00 year-round. The exact local-day bounds are half-open.
  const fromTimestamp = Date.parse(`${day}T00:00:00.000+07:00`);
  const toTimestamp = fromTimestamp + DAY_MS;
  const firstUtcDate = new Date(fromTimestamp).toISOString().slice(0, 10);
  const lastUtcDate = new Date(toTimestamp - 1).toISOString().slice(0, 10);

  return {
    selectedDate: day,
    fromTimestamp,
    toTimestamp,
    // X's documented since/until operators take dates, so overfetch the UTC
    // dates touched by this WIB day, then apply the exact timestamp filter.
    querySince: firstUtcDate,
    queryUntil: addUtcDays(lastUtcDate, 1),
  };
}

export function tweetIsInJakartaDay(tweet, window) {
  const publishedAt = tweet?.createdAt ?? tweet?.created_at ?? tweet?.timestamp;
  if (typeof publishedAt !== "string" || !publishedAt.trim()) return false;
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp >= window.fromTimestamp && timestamp < window.toTimestamp;
}
