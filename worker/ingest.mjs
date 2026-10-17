#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function readInput(path) {
  if (path) return JSON.parse(await readFile(path, "utf8"));
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) throw new Error("Provide a normalized JSON file path or pipe JSON to stdin.");
  return JSON.parse(input);
}
function isAllowedTransport(url) {
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
}
const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export async function sendBatch(payload, env = process.env) {
  const endpoint = env.INGESTION_URL;
  const secret = env.INGESTION_SECRET;
  if (!endpoint || !secret) throw new Error("Set INGESTION_URL and INGESTION_SECRET in the worker environment.");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("INGESTION_URL must be a valid URL."); }
  if (!isAllowedTransport(url)) throw new Error("INGESTION_URL must use HTTPS (HTTP is allowed only for localhost tests).");
  if (payload?.schemaVersion !== 1 || payload?.source !== "agent-reach" || typeof payload?.eventId !== "string" || !Array.isArray(payload?.nfts) || !Array.isArray(payload?.gtd) || !Array.isArray(payload?.tokens) || !Array.isArray(payload?.narratives)) {
    throw new Error("Input must be a normalized schemaVersion 1 Agent-Reach envelope.");
  }

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network request failed.");
      if (attempt < 3) { await delay(500 * (2 ** attempt)); continue; }
      break;
    }
    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      return { accepted: true, duplicate: Boolean(result.duplicate), eventId: payload.eventId };
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Ingestion endpoint returned ${response.status}.`);
      if (attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 500 * (2 ** attempt));
        continue;
      }
      break;
    }
    throw new Error(`Ingestion endpoint rejected the batch (${response.status}); retry only after correcting the request/configuration.`);
  }
  throw lastError instanceof Error ? lastError : new Error("Ingestion failed after bounded retries.");
}

async function main() {
  try {
    const payload = await readInput(process.argv[2]);
    console.log(JSON.stringify(await sendBatch(payload)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Ingestion failed.");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
