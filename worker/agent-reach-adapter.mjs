#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getJakartaDayWindow, tweetIsInJakartaDay } from "./search-window.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_MARKERS = [
  ["ethereum", /\b(?:ethereum(?:\s+mainnet)?|erc[- ]?20)\b/i],
  ["base", /\b(?:on\s+base|base\s+(?:chain|network|launch|token|meme)|#base)\b/i],
  ["arbitrum", /\b(?:arbitrum(?:\s+one)?|arb\s+one)\b/i],
  ["optimism", /\b(?:optimism(?:\s+mainnet)?|op\s+mainnet)\b/i],
  ["polygon", /\b(?:polygon(?:\s+network)?|matic\s+network)\b/i],
  ["bsc", /\b(?:bsc|bnb\s+chain|binance\s+smart\s+chain)\b/i],
  ["solana", /\bsolana\b|\bpump\.fun\b/i],
];
const EVM_ADDRESS_RE = /\b0x[a-f0-9]{40}\b/gi;
const SOLANA_CA_RE = /\b(?:ca|contract(?:\s+address)?|mint(?:\s+address)?)\s*[:=]\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/gi;
const TICKER_RE = /\$([A-Z][A-Z0-9]{1,9})\b/gi;
const CATEGORY_LABELS = { nft: "NFT mints", meme: "Meme coins", narratives: "Crypto narratives" };

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const integerOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

function trustedXUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && (host === "x.com" || host === "twitter.com") ? value : undefined;
  } catch {
    return undefined;
  }
}

function toIso(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function getField(object, keys) {
  for (const key of keys) {
    if (object?.[key] != null) return object[key];
  }
  return undefined;
}

export function normalizeTweet(tweet) {
  if (!tweet || typeof tweet !== "object" || typeof tweet.text !== "string") return null;
  const text = tweet.text.trim();
  if (!text || text.length > 4000) return null;
  const authorObject = tweet.author && typeof tweet.author === "object" ? tweet.author : {};
  const rawAuthor = getField(authorObject, ["screenName", "username", "handle"]) ?? getField(tweet, ["screenName", "username"]);
  const author = typeof rawAuthor === "string" && rawAuthor.trim() ? rawAuthor.trim() : undefined;
  const rawId = getField(tweet, ["id", "id_str"]);
  const externalId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
  const metrics = tweet.metrics && typeof tweet.metrics === "object" ? tweet.metrics : {};
  const likes = integerOrNull(metrics.likes);
  const reposts = integerOrNull(getField(metrics, ["retweets", "reposts"]));
  const replies = integerOrNull(metrics.replies);
  const sourceUrl = trustedXUrl(getField(tweet, ["url", "tweetUrl", "permalink"]));
  const authorUrl = trustedXUrl(getField(authorObject, ["profileUrl", "profile_url"]));
  const publishedAt = toIso(getField(tweet, ["createdAt", "created_at", "timestamp"]));

  return {
    ...(externalId ? { externalId } : {}),
    text,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(author ? { author } : {}),
    ...(authorUrl ? { authorUrl } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(likes != null ? { likes } : {}),
    ...(reposts != null ? { reposts } : {}),
    ...(replies != null ? { replies } : {}),
  };
}

export function parseSearchOutput(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Twitter CLI did not return valid JSON; no data was ingested.");
  }
  if (!parsed || parsed.ok !== true || !Array.isArray(parsed.data)) {
    throw new Error("Twitter search returned an unsuccessful or unsupported response; no data was ingested.");
  }
  return parsed.data;
}

function dedupePosts(posts) {
  const unique = new Map();
  for (const post of posts) {
    const key = post.externalId ? `id:${post.externalId}` : post.sourceUrl ? `url:${post.sourceUrl}` : `text:${(post.author ?? "").toLowerCase()}|${post.publishedAt ?? ""}|${post.text.toLowerCase()}`;
    const existing = unique.get(key);
    unique.set(key, existing ? {
      ...existing,
      ...post,
      externalId: existing.externalId ?? post.externalId,
      text: post.text.length > existing.text.length ? post.text : existing.text,
      sourceUrl: post.sourceUrl ?? existing.sourceUrl,
      author: existing.author ?? post.author,
      authorUrl: existing.authorUrl ?? post.authorUrl,
      publishedAt: existing.publishedAt ?? post.publishedAt,
      likes: post.likes ?? existing.likes,
      reposts: post.reposts ?? existing.reposts,
      replies: post.replies ?? existing.replies,
    } : post);
  }
  return [...unique.values()];
}

function interleavedSearches(config) {
  return Object.entries(config)
    .filter(([, terms]) => Array.isArray(terms))
    .map(([group, terms]) => [group, [...new Set(terms.filter((term) => typeof term === "string" && term.trim()).map((term) => term.trim()))]])
    .filter(([, terms]) => terms.length > 0);
}

export function selectSearches(config, maxSearches, offset = 0) {
  const groups = interleavedSearches(config);
  if (!groups.length) throw new Error("The X query configuration has no usable search terms.");
  const maximum = Math.max(1, Math.min(30, Math.floor(Number(maxSearches) || 3)));
  const startAt = Math.max(0, Math.floor(Number(offset) || 0));
  const selected = [];
  for (let round = 0; selected.length < maximum; round += 1) {
    let addedThisRound = false;
    for (const [group, terms] of groups) {
      if (selected.length >= maximum) break;
      if (round >= terms.length) continue;
      selected.push({ group, query: terms[(startAt + round) % terms.length] });
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }
  return selected;
}

function decodeBase58ByteLength(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of address) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  let significantBytes = 0;
  for (let value = number; value > 0n; value >>= 8n) significantBytes += 1;
  const leadingZeroBytes = (address.match(/^1+/)?.[0].length ?? 0);
  return significantBytes + leadingZeroBytes;
}

function extractExplicitChain(text) {
  const matches = CHAIN_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([chain]) => chain);
  return matches.length === 1 ? matches[0] : null;
}

function extractAddresses(text, chain) {
  if (chain === "solana") {
    const addresses = [...text.matchAll(SOLANA_CA_RE)].map((match) => match[1]);
    return [...new Set(addresses.filter((address) => decodeBase58ByteLength(address) === 32))];
  }
  return [...new Set(text.match(EVM_ADDRESS_RE) ?? [])];
}

function extractTickers(text) {
  return [...new Set([...text.matchAll(TICKER_RE)].map((match) => match[1].toUpperCase()))];
}

function addUniquePost(target, post) {
  const previous = dedupePosts([...target, post]);
  target.splice(0, target.length, ...previous);
}

function makeTokenCandidates(postsByGroup, discoveredAt) {
  const candidates = new Map();
  for (const [group, posts] of postsByGroup) {
    for (const post of posts) {
      const chain = extractExplicitChain(post.text);
      if (!chain) continue;
      const tickers = extractTickers(post.text);
      const addresses = extractAddresses(post.text, chain);
      if (tickers.length !== 1 || addresses.length !== 1) continue;
      const address = addresses[0];
      const key = `${chain}:${address.toLowerCase()}`;
      const current = candidates.get(key);
      if (current && current.symbol !== tickers[0]) continue;
      const row = current ?? {
        id: `x-${chain}-${address.toLowerCase()}`,
        name: `$${tickers[0]}`,
        symbol: tickers[0],
        address,
        chain,
        metrics: {},
        narrativeCategory: CATEGORY_LABELS[group] ?? group,
        discoveredAt,
        sourcePosts: [],
        ctoStatus: "none",
        demo: false,
        _group: group,
      };
      addUniquePost(row.sourcePosts, post);
      candidates.set(key, row);
    }
  }
  return [...candidates.values()].map(({ _group, ...row }) => {
    const posts = row.sourcePosts.slice(0, 50);
    const allEngagementKnown = posts.length > 0 && posts.every((post) => post.likes != null && post.reposts != null && post.replies != null);
    return {
      ...row,
      sourcePosts: posts,
      xMentionCount: posts.length,
      xEngagement: allEngagementKnown ? posts.reduce((sum, post) => sum + post.likes + post.reposts + post.replies, 0) : null,
    };
  });
}

function countUniqueAuthors(posts) {
  if (!posts.length || posts.some((post) => !post.author)) return null;
  return new Set(posts.map((post) => post.author.toLowerCase())).size;
}

function sumKnownEngagement(posts) {
  if (!posts.length || posts.some((post) => post.likes == null || post.reposts == null || post.replies == null)) return null;
  return posts.reduce((sum, post) => sum + post.likes + post.reposts + post.replies, 0);
}

function countContractLikeStrings(posts) {
  const values = new Set();
  for (const post of posts) {
    for (const address of post.text.match(EVM_ADDRESS_RE) ?? []) values.add(address.toLowerCase());
    const chain = extractExplicitChain(post.text);
    if (chain === "solana") for (const address of extractAddresses(post.text, chain)) values.add(address);
  }
  return values.size;
}

export function buildEnvelope(results, syncedAt = new Date().toISOString()) {
  const postsByGroup = new Map();
  const keywordsByGroup = new Map();
  for (const { group, query, tweets } of results) {
    const current = postsByGroup.get(group) ?? [];
    const mapped = tweets.map(normalizeTweet).filter(Boolean);
    postsByGroup.set(group, dedupePosts([...current, ...mapped]));
    const keywords = keywordsByGroup.get(group) ?? [];
    if (mapped.length && !keywords.includes(query)) keywords.push(query);
    keywordsByGroup.set(group, keywords);
  }

  const tokens = makeTokenCandidates(postsByGroup, syncedAt).slice(0, 200);
  const narratives = [];
  for (const [group, posts] of postsByGroup) {
    const sourcePosts = posts.slice(0, 100);
    if (!sourcePosts.length) continue;
    narratives.push({
      id: `agent-reach-x-${group}`,
      category: CATEGORY_LABELS[group] ?? group,
      keywords: (keywordsByGroup.get(group) ?? []).slice(0, 100),
      mentionCount: sourcePosts.length,
      uniqueAuthors: countUniqueAuthors(sourcePosts),
      engagement: sumKnownEngagement(sourcePosts),
      growthPct: null,
      accelerationScore: null,
      securityPassRatio: null,
      contractMentionCount: countContractLikeStrings(sourcePosts),
      discoveredTokenCount: tokens.filter((token) => token.narrativeCategory === (CATEGORY_LABELS[group] ?? group)).length,
      sourcePosts,
      lastUpdatedAt: syncedAt,
      demo: false,
    });
  }

  return {
    schemaVersion: 1,
    source: "agent-reach",
    eventId: `agent-reach-${Date.now()}-${randomUUID().slice(0, 8)}`,
    syncedAt,
    nfts: [],
    gtd: [],
    tokens,
    narratives,
  };
}

function readIntegerSetting(name, fallback, minimum, maximum, env = process.env) {
  const parsed = Number(env[name]);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function resolveTwitterCli(env = process.env) {
  const explicit = typeof env.TWITTER_CLI_BIN === "string" ? env.TWITTER_CLI_BIN.trim() : "";
  if (explicit) return explicit;

  const candidate = resolve(env.HOME || homedir(), ".local", "bin", "twitter");
  try {
    accessSync(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return "twitter";
  }
}

function runSearch(query, maxResults, timeoutMs) {
  const executable = resolveTwitterCli();
  const result = spawnSync(executable, ["search", query, "--max", String(maxResults), "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OUTPUT: "json",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: [resolve(ROOT, "worker/twitter-cli-compat"), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
    maxBuffer: 1_000_000,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") throw new Error("The documented twitter-cli executable is missing from the worker PATH.");
    if (result.error.code === "ETIMEDOUT") throw new Error("Twitter search timed out; no batch was ingested.");
    throw new Error("Twitter search could not be completed; no batch was ingested.");
  }
  if (result.status !== 0) throw new Error("Twitter search failed; check X authentication, network access, and rate limits. No batch was ingested.");
  return parseSearchOutput(result.stdout);
}

export async function collectSocialData(env = process.env) {
  if (!env.TWITTER_AUTH_TOKEN || !env.TWITTER_CT0) {
    throw new Error("Set both TWITTER_AUTH_TOKEN and TWITTER_CT0 explicitly in the worker environment; the adapter will not scan browser cookies.");
  }
  const configPath = env.AGENT_REACH_QUERY_CONFIG
    ? resolve(env.AGENT_REACH_QUERY_CONFIG)
    : resolve(ROOT, "config/x-queries.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    throw new Error("The configured X query file is missing or invalid JSON.");
  }
  const window = getJakartaDayWindow(env.AGENT_REACH_SEARCH_DATE?.trim() || null);
  const offset = readIntegerSetting("AGENT_REACH_QUERY_OFFSET", Math.floor(Date.now() / (15 * 60 * 1000)), 0, 1_000_000_000, env);
  const searches = selectSearches(config, readIntegerSetting("AGENT_REACH_MAX_SEARCHES", 3, 1, 30, env), offset);
  const maxResults = readIntegerSetting("AGENT_REACH_RESULTS_PER_QUERY", 10, 1, 25, env);
  const delayMs = readIntegerSetting("AGENT_REACH_QUERY_DELAY_MS", 500, 0, 10_000, env);
  const timeoutMs = readIntegerSetting("AGENT_REACH_SEARCH_TIMEOUT_MS", 30_000, 1_000, 60_000, env);
  const results = [];
  for (let index = 0; index < searches.length; index += 1) {
    const { group, query } = searches[index];
    const datedQuery = `${query} since:${window.querySince} until:${window.queryUntil}`;
    const tweets = runSearch(datedQuery, maxResults, timeoutMs).filter((tweet) => tweetIsInJakartaDay(tweet, window));
    results.push({ group, query: datedQuery, tweets });
    if (delayMs && index < searches.length - 1) await sleep(delayMs);
  }
  return buildEnvelope(results);
}

async function main() {
  try {
    const envelope = await collectSocialData();
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Agent-Reach social collection failed; no batch was ingested.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
