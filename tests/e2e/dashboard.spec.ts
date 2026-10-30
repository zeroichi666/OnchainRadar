import { expect, test } from "@playwright/test";

test("dashboard visibly labels demo mode and navigation changes the active view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header").getByText("demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  for (const section of ["Free Mint", "GTD Mint", "Meme Coins", "Web3 Games", "Community Takeover", "X Narratives", "Security Review", "Watchlist", "Settings"]) {
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
  expect((await request.get("/api/nfts/free-mints?from=2026-02-29")).status()).toBe(400);
  expect((await request.get("/api/nfts/free-mints?from=2026-02-03&to=2026-02-01")).status()).toBe(400);
  expect((await request.get("/api/nfts/free-mints?status=unknown-status")).status()).toBe(400);
  expect((await request.get("/api/nfts/free-mints?type=paid")).status()).toBe(400);
  expect((await request.get("/api/nfts/gtd-mints?from=not-a-date")).status()).toBe(400);
  expect((await request.get("/api/nfts/gtd-mints?status=ordinary-allowlist")).status()).toBe(400);
  expect((await request.get("/api/nfts/gtd-mints?from=2026-02-01&to=2026-02-28")).status()).toBe(200);
  expect((await request.get("/api/dashboard?socialDate=today")).status()).toBe(200);
  expect((await request.get("/api/dashboard?socialDate=2026-02-29")).status()).toBe(400);
});

test("detected X claim groups show actual source links in Free Mint, GTD, Meme Coins, CTO, and narratives", async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-17T12:00:00.000Z") });
  const response = await request.get("/api/dashboard");
  const payload = await response.json();
  payload.nfts = [];
  payload.gtd = [];
  payload.tokens = [];
  payload.ctoClaims = [];
  payload.socialReviewQueue = [
    {
      id: "claim:project:inkbubblecats", groupingKeys: ["project:inkbubblecats"], label: "@InkBubbleCats",
      status: "detected", sourceStatus: "available", originCategories: ["NFT mints"], originQueries: ["FCFS mint"], syncedAt: "2026-10-17T11:07:36.700Z",
      claimSignals: ["free-mint-wording", "gtd-wording", "fcfs-wording", "giveaway-wording"], candidateAreas: ["free-mint", "gtd-mint"], tickers: [], contractAddresses: [], chainClaims: [],
      sourcePosts: [{ externalId: "2111410627348509162", author: "Jennifer_Verse", sourceUrl: "https://x.com/Jennifer_Verse/status/2111410627348509162", text: "FREE MINT GIVEAWAY — @InkBubbleCats. 10 GTD + 50 FCFS.", publishedAt: "2026-10-17T10:54:56.000Z", likes: 49, reposts: 37, replies: 52 }],
    },
    {
      id: "claim:project:wormlings_nft", groupingKeys: ["project:wormlings_nft"], label: "@wormlings_nft",
      status: "detected", sourceStatus: "available", originCategories: ["NFT mints"], originQueries: ["FCFS mint"], syncedAt: "2026-10-17T11:07:36.700Z",
      claimSignals: ["gtd-wording", "fcfs-wording", "giveaway-wording"], candidateAreas: ["gtd-mint"], tickers: [], contractAddresses: [], chainClaims: ["ethereum"],
      sourcePosts: [{ externalId: "2111409268926677091", author: "Emma_Telly_", sourceUrl: "https://x.com/Emma_Telly_/status/2111409268926677091", text: "Giving away 5GTD and 10 FCFS spots for @wormlings_nft.", publishedAt: "2026-10-17T10:49:32.000Z" }],
    },
    {
      id: "claim:ticker:MEME", groupingKeys: ["contract:3j92g6mygezuq25atdy8xpssch7hsn33pjh31zqp61rg", "ticker:MEME"], label: "$MEME",
      status: "detected", sourceStatus: "available", originCategories: ["Meme coins"], originQueries: ["new meme coin"], syncedAt: "2026-10-17T11:07:36.700Z",
      claimSignals: ["meme-token-mentioned", "public-meme-call-wording"], candidateAreas: ["meme-coin"], tickers: ["MEME"], contractAddresses: ["3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg"], chainClaims: ["solana"],
      sourcePosts: [
        { externalId: "2108823799999221862", author: "Nakameowdough", sourceUrl: "https://x.com/Nakameowdough/status/2108823799999221862", text: "$MEME 13.2M. The LONG ecosystem will go from strength to strength.", publishedAt: "2026-10-10T07:35:48.000Z" },
        { externalId: "2111408388324131242", author: "Shelly87120880", sourceUrl: "https://x.com/Shelly87120880/status/2111408388324131242", text: "Discover MEMEcoin $MEME on Solana. CA=3j92g6mygEzuQ25Atdy8xPsScH7hsn33PjH31ZqP61Rg. Worth a look.", publishedAt: "2026-10-17T10:46:02.000Z" },
      ],
    },
  ];
  await page.route("**/api/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.goto("/");

  await page.getByRole("button", { name: "Free Mint" }).click();
  const free = page.getByRole("region", { name: "Free Mint claim detected" });
  await expect(free.getByLabel("Filter social posts by date (WIB)")).toHaveValue("2026-10-17");
  await expect(free).toContainText("Detected claim · wording only");
  await expect(free.getByRole("link", { name: "Open original X post" })).toHaveAttribute("href", "https://x.com/Jennifer_Verse/status/2111410627348509162");
  await expect(page.getByText("No matching opportunities")).toBeVisible();

  await page.getByRole("button", { name: "GTD Mint" }).click();
  const gtd = page.getByRole("region", { name: "GTD Mint claim detected" });
  await expect(gtd).toContainText("GTD wording detected");
  await expect(gtd.getByRole("link", { name: "Open original X post" })).toHaveCount(2);
  await page.getByRole("button", { name: "Meme Coins" }).click();
  const meme = page.getByRole("region", { name: "Public meme-call signal" });
  await expect(meme).toContainText("$MEME");
  await expect(meme.getByRole("link", { name: "Open original X post" })).toHaveCount(1);
  await expect(meme.locator("a[href='https://x.com/Shelly87120880/status/2111408388324131242']")).toHaveCount(1);
  await meme.getByRole("button", { name: "All history" }).click();
  await expect(meme.getByRole("link", { name: "Open original X post" })).toHaveCount(2);
  await meme.getByRole("button", { name: "Today · WIB" }).click();
  await expect(meme.getByRole("link", { name: "Open original X post" })).toHaveCount(1);
  await page.getByRole("button", { name: "Community Takeover" }).click();
  await expect(page.getByRole("region", { name: "CTO claim detected" })).toContainText("No explicit CTO wording was detected");
  await page.getByRole("button", { name: "X Narratives" }).click();
  const all = page.getByRole("region", { name: "Detected X claim groups" });
  await expect(all).toContainText("3 grouped records · 3 source posts");
  await all.getByRole("button", { name: "All history" }).click();
  await expect(all).toContainText("3 grouped records · 4 source posts");
});

test("Web3 Games displays source-linked X signals and supports search and chain filtering", async ({ page, request }) => {
  const response = await request.get("/api/dashboard");
  const payload = await response.json();
  payload.narratives = [{
    id: "agent-reach-x-games", category: "Web3 Games", keywords: ["onchain game playtest"], mentionCount: 1,
    uniqueAuthors: 1, engagement: null, growthPct: null, accelerationScore: null, securityPassRatio: null,
    sourcePosts: [{ externalId: "game-1", author: "GameStudio", sourceUrl: "https://x.com/GameStudio/status/game-1", text: "Web3 game playtest on Ronin starts today", publishedAt: "2026-10-17T10:00:00.000Z" }],
    lastUpdatedAt: "2026-10-17T10:00:00.000Z", demo: false,
  }];
  await page.route("**/api/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Web3 Games" }).click();
  await expect(page.getByRole("heading", { name: "Web3 Games", exact: true })).toBeVisible();
  await expect(page.getByText("Discovery only: social posts and chain mentions are not independently verified.")).toBeVisible();
  await expect(page.locator("span").filter({ hasText: /^playtest$/ })).toBeVisible();
  await expect(page.locator("span").filter({ hasText: /^Ronin$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open original X post ↗" })).toHaveAttribute("href", "https://x.com/GameStudio/status/game-1");
  await page.getByLabel("Filter game signals by chain").selectOption("ronin");
  await expect(page.getByText("1 signal · sorted by source post time")).toBeVisible();
  await page.getByLabel("Search game signals").fill("no-match");
  await expect(page.getByRole("heading", { name: "No matching game signals" })).toBeVisible();
});

test("social ingestion cannot be used without valid worker credentials", async ({ request }) => {
  const response = await request.post("/api/ingest/social", { data: { schemaVersion: 1 } });
  expect([401, 503]).toContain(response.status());
});
