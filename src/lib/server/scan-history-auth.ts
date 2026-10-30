import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { allowRateLimit, getClientIp } from "@/lib/server/rate-limit";

const NO_STORE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function deny(message: string, status: number, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } });
}

function matches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const entries = [
    process.env.APP_ORIGIN,
    process.env.SITE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.ALLOWED_INGEST_ORIGINS,
  ].flatMap((value) => (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  return new Set(entries.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin)));
}

export function authorizeScanHistoryDelete(request: Request): NextResponse | null {
  const ip = getClientIp(request.headers);
  if (!allowRateLimit(`scan-history-delete:${ip}`, 5, 15 * 60_000)) {
    return deny("Rate limit exceeded. Retry later.", 429, { "Retry-After": "900" });
  }

  const secret = process.env.SCAN_HISTORY_DELETE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    return deny("Scan history deletion is not configured on this server.", 503);
  }

  const origins = configuredOrigins();
  if (!origins.size) {
    return deny("An allowed application Origin is not configured on this server.", 503);
  }

  const requestOrigin = request.headers.get("origin");
  const normalizedRequestOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null;
  if (!normalizedRequestOrigin || !origins.has(normalizedRequestOrigin)) {
    return deny("Origin is not allowed for scan history deletion.", 403);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !matches(secret, provided)) return deny("Unauthorized.", 401);
  return null;
}
