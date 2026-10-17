import { expect, test } from "@playwright/test";

test("dashboard visibly labels demo mode and navigation changes the active view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header").getByText("demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  for (const section of ["Free Mint", "GTD Mint", "Meme Coins", "Community Takeover", "X Narratives", "Security Review", "Watchlist", "Settings"]) {
    await page.getByRole("button", { name: section }).click();
    await expect(page.locator("header").getByText(section, { exact: true })).toBeVisible();
  }
  expect(await page.getByLabel("Minimum liquidity (USD) · mandatory").getAttribute("min")).toBe("1");
  expect(await page.getByLabel("Minimum liquidity / market cap (%)").getAttribute("min")).toBe("1");
});

test("mobile navigation opens and selects a section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Security Review" }).click();
  await expect(page.getByRole("heading", { name: "Security Review", exact: true })).toBeVisible();
});

test("read APIs return explicit demo payloads and validate query/address inputs", async ({ request }) => {
  const dashboard = await request.get("/api/dashboard");
  expect(dashboard.ok()).toBeTruthy();
  const payload = await dashboard.json();
  expect(payload.mode).toBe("demo");
  expect(payload.warnings.join(" ")).toMatch(/fictional placeholders/i);
  expect(payload.tokens).toEqual([]);

  for (const path of ["/api/health", "/api/sync/status", "/api/tokens", "/api/nfts/free-mints", "/api/nfts/gtd-mints", "/api/cto", "/api/narratives", "/api/security/review"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.json()).mode, path).toBe("demo");
  }

  expect((await request.get("/api/tokens/ethereum/not-an-address")).status()).toBe(400);
  expect((await request.get("/api/tokens?chain=not-a-chain")).status()).toBe(400);
  expect((await request.get("/api/nfts/free-mints?chain=not-a-chain")).status()).toBe(400);
});

test("social ingestion cannot be used without valid worker credentials", async ({ request }) => {
  const response = await request.post("/api/ingest/social", { data: { schemaVersion: 1 } });
  expect([401, 503]).toContain(response.status());
});
