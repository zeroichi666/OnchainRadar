import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { allowRateLimit, getClientIp } from "@/lib/server/rate-limit";

function matches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authorizeWorkerRequest(request: Request, namespace: string, limit = 30): NextResponse | null {
  const ip = getClientIp(request.headers);
  if (!allowRateLimit(`${namespace}:${ip}`, limit, 60_000)) return NextResponse.json({ error: "Rate limit exceeded. Retry later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  const origin = request.headers.get("origin");
  if (origin) {
    const configured = [process.env.APP_ORIGIN, process.env.SITE_URL, process.env.URL, process.env.DEPLOY_PRIME_URL, ...(process.env.ALLOWED_INGEST_ORIGINS ?? "").split(",")].filter(Boolean).map((value) => value!.replace(/\/$/, ""));
    if (!configured.includes(origin.replace(/\/$/, ""))) return NextResponse.json({ error: "Origin is not allowed for ingestion." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const secret = process.env.INGESTION_SECRET;
  if (!secret) return NextResponse.json({ error: "Ingestion is not configured on this server." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !matches(secret, provided)) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return null;
}
