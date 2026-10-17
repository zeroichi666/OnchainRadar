import { NextResponse } from "next/server";
import { allowRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { RadarClientSettingsSchema, type RadarClientSettings } from "@/lib/settings";

export function publicReadLimit(request: Request): NextResponse | null {
  if (allowRateLimit(`read:${getClientIp(request.headers)}`, 120, 60_000)) return null;
  return NextResponse.json({ error: "Read rate limit exceeded. Retry later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
}

export function clientSettingsFromRequest(request: Request): { settings?: RadarClientSettings; error?: string } {
  const value = new URL(request.url).searchParams.get("settings");
  if (!value) return {};
  if (value.length > 2000) return { error: "Settings parameter is too large." };
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return { error: "Settings parameter must be valid JSON." }; }
  const result = RadarClientSettingsSchema.safeParse(raw);
  return result.success ? { settings: result.data } : { error: "Settings parameter is invalid." };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function readBoundedJson(request: Request, maximumBytes = 1_000_000): Promise<unknown> {
  const headerLength = Number(request.headers.get("content-length") ?? 0);
  if (headerLength > maximumBytes) throw new RangeError("payload-too-large");
  if (!request.body) throw new Error("empty-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) { await reader.cancel(); throw new RangeError("payload-too-large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
