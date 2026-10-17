import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { sendBatch } from "./ingest.mjs";

const payload = { schemaVersion: 1, eventId: "worker-test-event-001", source: "agent-reach", syncedAt: new Date().toISOString(), nfts: [], gtd: [], tokens: [], narratives: [] };
const servers = [];
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/api/ingest/social`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))); });

describe("worker transport", () => {
  it("posts the normalized envelope with bearer auth and returns accepted metadata", async () => {
    const endpoint = await listen((request, response) => {
      assert.equal(request.headers.authorization, "Bearer worker-test-secret");
      let body = ""; request.on("data", (chunk) => body += chunk); request.on("end", () => { assert.equal(JSON.parse(body).eventId, payload.eventId); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true, duplicate: false })); });
    });
    const result = await sendBatch(payload, { INGESTION_URL: endpoint, INGESTION_SECRET: "worker-test-secret" });
    assert.deepEqual(result, { accepted: true, duplicate: false, eventId: payload.eventId });
  });
  it("retries a 429 once and then succeeds", async () => {
    let attempts = 0;
    const endpoint = await listen((_request, response) => { attempts += 1; if (attempts === 1) { response.writeHead(429, { "retry-after": "0" }); response.end(); } else { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); } });
    const result = await sendBatch(payload, { INGESTION_URL: endpoint, INGESTION_SECRET: "worker-test-secret" });
    assert.equal(result.accepted, true); assert.equal(attempts, 2);
  });
  it("does not retry a permanent 422 response", async () => {
    let attempts = 0;
    const endpoint = await listen((_request, response) => { attempts += 1; response.writeHead(422); response.end("invalid"); });
    await assert.rejects(() => sendBatch(payload, { INGESTION_URL: endpoint, INGESTION_SECRET: "worker-test-secret" }), /422/);
    assert.equal(attempts, 1);
  });
  it("requires HTTPS outside localhost and rejects incomplete envelopes", async () => {
    await assert.rejects(() => sendBatch(payload, { INGESTION_URL: "http://example.com", INGESTION_SECRET: "secret" }), /HTTPS/);
    await assert.rejects(() => sendBatch({ schemaVersion: 1 }, { INGESTION_URL: "https://example.com", INGESTION_SECRET: "secret" }), /normalized/);
  });
});
