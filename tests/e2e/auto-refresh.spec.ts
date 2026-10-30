import { expect, test, type Page } from "@playwright/test";

async function openMockDashboard(page: Page, payload: Record<string, unknown>, respond: (call: number, url: string) => { status?: number; body: unknown } | null) {
  let calls = 0;
  let ready = false;
  await page.clock.install({ time: new Date("2026-10-17T12:00:00Z") });
  await page.route("**/api/dashboard**", async (route) => {
    const result = ready ? respond(++calls, route.request().url()) : { body: payload };
    if (!result) return; // Intentionally pending to exercise overlap/timeout protection.
    await route.fulfill({ status: result.status ?? 200, contentType: "application/json", body: JSON.stringify(result.body) });
  });
  await page.goto("/");
  await expect(page.locator("header").getByText(String(payload.mode), { exact: true })).toBeVisible();
  calls = 1;
  ready = true;
  return () => calls;
}

test("refresh occurs at ten minutes and keeps navigation, social date, and watchlist", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  const updated = structuredClone(payload);
  updated.narratives[0].category = "Fresh source data";
  const calls = await openMockDashboard(page, payload, (n) => ({ body: n === 1 ? payload : updated }));
  await page.getByRole("button", { name: "Mint Scanner", exact: true }).click();
  await page.getByRole("button", { name: "Add to watchlist" }).first().click();
  await page.getByRole("button", { name: "X Narratives", exact: true }).click();
  await page.getByRole("button", { name: "All history", exact: true }).click();
  await page.clock.fastForward(599_000);
  expect(calls()).toBe(1);
  await page.clock.fastForward(1_000);
  await expect(page.getByText("Fresh source data", { exact: true })).toBeVisible();
  expect(calls()).toBe(2);
  await expect(page.getByLabel("Filter social posts by date (WIB)")).toHaveValue("");
  await expect(page.locator("header").getByText("X Narratives", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("onchain-radar.watchlist.v1") ?? "[]").length)).toBe(1);
});

test("empty, failed and malformed refresh retain the last snapshot then recover", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  const empty = { ...payload };
  for (const key of ["nfts", "gtd", "tokens", "ctoClaims", "securityQueue", "securityReports", "providerReports", "narratives", "socialReviewQueue", "recentExclusions"]) empty[key] = [];
  const calls = await openMockDashboard(page, payload, (n) => n === 2 ? { body: empty } : n === 3 ? { status: 503, body: { error: "unavailable" } } : n === 4 ? { body: { invalid: true } } : { body: payload });
  await page.getByRole("button", { name: "X Narratives", exact: true }).click();
  const title = page.getByText(payload.narratives[0].category, { exact: true }).first();
  await page.clock.fastForward(600_000);
  await expect(page.getByRole("status")).toContainText("previous snapshot");
  await expect(title).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(page.locator("main").getByRole("alert")).toContainText("503");
  await expect(title).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(page.locator("main").getByRole("alert")).toContainText("schema");
  await expect(title).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Refresh complete");
  expect(calls()).toBe(5);
});

test("manual refresh does not overlap a pending automatic request and timeout recovers", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  const calls = await openMockDashboard(page, payload, (n) => n === 2 ? null : { body: payload });
  await page.clock.fastForward(600_000);
  await expect(page.getByRole("button", { name: "Refresh dashboard", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Mint Scanner", exact: true }).click();
  expect(calls()).toBe(2);
  await page.clock.fastForward(60_000);
  await expect(page.locator("main").getByRole("alert")).toContainText("timed out");
  await expect(page.getByRole("button", { name: "Refresh dashboard", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Refresh complete");
  expect(calls()).toBe(3);
});

test("initial empty results remain valid and retry automatically", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  for (const key of ["nfts", "gtd", "tokens", "ctoClaims", "securityQueue", "securityReports", "providerReports", "narratives", "socialReviewQueue", "recentExclusions"]) payload[key] = [];
  const calls = await openMockDashboard(page, payload, () => ({ body: payload }));
  await page.clock.fastForward(600_000);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Refresh complete");
  expect(calls()).toBe(2);
});

test("automatic refresh uses the latest saved settings", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  const settingsQueries: Record<string, unknown>[] = [];
  const calls = await openMockDashboard(page, payload, (_n, url) => {
    settingsQueries.push(JSON.parse(new URL(url).searchParams.get("settings")!));
    return { body: payload };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Minimum liquidity (USD) · mandatory").fill("25000");
  await page.getByRole("button", { name: "Save and apply", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Refresh complete");
  await page.clock.fastForward(600_000);
  await expect.poll(() => calls()).toBe(3);
  expect(settingsQueries).toHaveLength(2);
  expect(settingsQueries[0].minimumLiquidityUsd).toBe(25000);
  expect(settingsQueries[1].minimumLiquidityUsd).toBe(25000);
});

test("a nonempty new snapshot replaces old records rather than blindly merging eligibility", async ({ page, request }) => {
  const payload = await (await request.get("/api/dashboard")).json();
  const updated = structuredClone(payload);
  const removedName = payload.nfts[0].name;
  updated.nfts = [];
  await openMockDashboard(page, payload, () => ({ body: updated }));
  await page.getByRole("button", { name: "Mint Scanner", exact: true }).click();
  await expect(page.getByRole("heading", { name: removedName, exact: true })).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(page.getByRole("status")).toContainText("Refresh complete");
  await expect(page.getByRole("heading", { name: removedName, exact: true })).toHaveCount(0);
});
