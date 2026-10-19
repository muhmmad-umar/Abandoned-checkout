import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createOAuthState } from "@ad-scaler/meta-client";
import { evaluateScaling, executeScaling, runCreativeAnalysis, syncPerformance } from "@ad-scaler/queue";
import { decryptSecret } from "@ad-scaler/shared";
import { setup, testBrief, type Harness } from "../../../packages/queue/tests/harness";
import { buildApp } from "../src/app";
import type { ApiServices } from "../src/services";

const run = process.env.DATABASE_URL ? describe : describe.skip;

run("API", () => {
  let h: Harness;
  let app: FastifyInstance;
  const scheduled: string[] = [];
  const tokenKey = randomBytes(32).toString("base64");
  const as = (clerkId = "user_test") => ({ "x-test-user": clerkId });

  beforeAll(async () => {
    h = await setup();
    const services: ApiServices = {
      db: h.db,
      authenticate: async (req) => {
        const id = req.headers["x-test-user"];
        return typeof id === "string" ? { clerkId: id, email: `${id}@brand.test` } : null;
      },
      jobs: {
        schedule: async (id) => void scheduled.push(id),
        unschedule: async () => {},
        sync: async () => {},
        creativeAnalysis: async () => {},
        evaluateScaling: async () => {},
        execute: (req) => executeScaling(h.deps, req),
      },
      meta: {
        app: { appId: "app", appSecret: "secret", redirectUri: "https://api.test/meta/callback" },
        exchangeCode: async () => ({ accessToken: "EAAB-live-token", expiresAt: new Date("2026-03-15T00:00:00Z") }),
        listAdAccounts: async () => [{ id: "act_99", name: "New Brand", currency: "USD" }],
        listCampaigns: async () => [],
      },
      secrets: { tokenKey, oauthState: "state-secret" },
      appUrl: "https://app.test",
      now: h.deps.now,
    };
    app = await buildApp(services);
  });
  afterAll(async () => {
    await app?.close();
    await h?.db.$disconnect();
  });

  it("requires sign-in", async () => {
    expect((await app.inject({ url: "/campaigns" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it("validates the Scaling Brief against the client's own constraints", async () => {
    const draft = await h.db.campaign.create({ data: { userId: h.userId, adAccountId: (await h.db.adAccount.findFirstOrThrow()).id, platformCampaignId: "cmp_new", name: "Draft" } });
    const res = await app.inject({ method: "POST", url: `/campaigns/${draft.id}/brief`, headers: as(), payload: { brief: { ...testBrief(), maxBudgetCap: 500 } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toContainEqual({ path: "brief.maxBudgetCap", message: "Max budget cap must be at least your current daily budget" });
  });

  it("submits a brief: roadmap, thresholds, and automation scheduled", async () => {
    const draft = await h.db.campaign.findFirstOrThrow({ where: { platformCampaignId: "cmp_new" } });
    const res = await app.inject({ method: "POST", url: `/campaigns/${draft.id}/brief`, headers: as(), payload: { brief: testBrief(), thresholdOverrides: { cooldownDays: 5 } } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.thresholds).toMatchObject({ cooldownDays: 5, hardStopMinRoas: 1.5, hardStopMaxCpa: 45, maxBudgetCap: 3000 });
    // 43 orders at $1,200/day reaches 100/day at cycle 5, before the $3,000 cap.
    expect(body.roadmap).toMatchObject({ reachesTarget: true, cooldownDays: 5 });
    expect(body.roadmap.cycles).toHaveLength(5);
    expect(body.roadmap.cycles.at(-1).estimatedOrders).toBeGreaterThanOrEqual(100);
    expect(body.roadmap.creativePlan).toMatch(/^To reach your target in \d+ cycles/);
    expect(scheduled).toContain(draft.id);
    expect((await h.db.campaign.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("active");
  });

  it("isolates tenants", async () => {
    expect((await app.inject({ url: `/campaigns/${h.campaignId}`, headers: as("intruder") })).statusCode).toBe(404);
    const list = await app.inject({ url: "/campaigns", headers: as("intruder") });
    expect(list.json()).toEqual([]);
  });

  it("serves the campaign page, the inline opinion, and applies the client's choice", async () => {
    await syncPerformance(h.deps, h.campaignId, 14);
    await runCreativeAnalysis(h.deps, h.campaignId, "manual");
    await evaluateScaling(h.deps, h.campaignId);

    const page = (await app.inject({ url: `/campaigns/${h.campaignId}`, headers: as() })).json();
    expect(page.goal).toMatchObject({ targetOrders: 100, status: "on_track", cyclesCompleted: 0 });
    expect(page.recommendation).toMatchObject({ status: "recommend", card: { budgetBefore: 1200, budgetIfApplied: 1440, options: [10, 20, 30] } });
    expect(page.creativeHealth.score).toBeGreaterThanOrEqual(60);

    const same = await app.inject({ method: "POST", url: `/campaigns/${h.campaignId}/recommendation/opinion`, headers: as(), payload: { clientPct: 20 } });
    expect(same.json().opinion).toBeNull();
    const bolder = await app.inject({ method: "POST", url: `/campaigns/${h.campaignId}/recommendation/opinion`, headers: as(), payload: { clientPct: 30 } });
    expect(bolder.json().opinion).toBe("We'd recommend 20% here. A 30% jump after 6 days of data may shock the algorithm before it stabilizes. Proceeding with your choice of 30%.");

    const scale = await app.inject({ method: "POST", url: `/campaigns/${h.campaignId}/scale`, headers: as(), payload: { recommendationId: page.recommendation.id, clientPct: 30 } });
    expect(scale.statusCode).toBe(200);
    expect(scale.json()).toMatchObject({ ok: true, budgetAfter: 1560 });

    const again = await app.inject({ method: "POST", url: `/campaigns/${h.campaignId}/scale`, headers: as(), payload: { recommendationId: page.recommendation.id, clientPct: 30 } });
    expect(again.statusCode).toBe(409);

    const cycles = (await app.inject({ url: `/campaigns/${h.campaignId}/cycles`, headers: as() })).json();
    expect(cycles.overrideHistory).toEqual([{ cycle: 1, systemSaid: "+20%", clientChose: "+30%", outcome: "In cooldown", early: false }]);
    const logs = (await app.inject({ url: `/campaigns/${h.campaignId}/logs`, headers: as() })).json();
    expect(logs[0]).toMatchObject({ actionType: "budget_change", apiCallStatus: "success", triggeredBy: "client_override" });
  });

  it("shows the early-scale card during cooldown", async () => {
    h.setNow("2026-01-17T12:00:00Z");
    await evaluateScaling(h.deps, h.campaignId);
    const rec = (await app.inject({ url: `/campaigns/${h.campaignId}/recommendation`, headers: as() })).json();
    expect(rec.earlyScale).toMatchObject({ dayOfCooldown: 2, cooldownLength: 4, daysRemaining: 2, verdict: "Wait until Day 4 (2 more days)" });
    expect(rec.goal.nextWindowInDays).toBe(2);
  });

  it("tracks creative brief items and creative tags", async () => {
    const brief = (await app.inject({ url: `/campaigns/${h.campaignId}/creative-brief`, headers: as() })).json();
    if (brief.items.length) {
      const r = await app.inject({ method: "PATCH", url: `/brief-items/${brief.items[0].id}`, headers: as(), payload: { status: "in_production" } });
      expect(r.json().status).toBe("in_production");
      expect((await app.inject({ method: "PATCH", url: `/brief-items/${brief.items[0].id}`, headers: as("intruder"), payload: { status: "live" } })).statusCode).toBe(404);
    }
    const creatives = (await app.inject({ url: `/campaigns/${h.campaignId}/creatives`, headers: as() })).json();
    expect(creatives.creatives).toHaveLength(5);
    const tagged = await app.inject({ method: "PATCH", url: `/ads/${creatives.creatives[0].id}`, headers: as(), payload: { tone: "humorous" } });
    expect(tagged.json().tone).toBe("humorous");
  });

  it("connects Meta via OAuth, storing tokens encrypted", async () => {
    const bad = await app.inject({ url: "/meta/callback?code=abc&state=forged.1.2.3" });
    expect(bad.headers.location).toBe("https://app.test/settings/accounts?error=expired");
    const state = createOAuthState(h.userId, "state-secret", 600_000, h.deps.now().getTime());
    const ok = await app.inject({ url: `/meta/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(ok.headers.location).toBe("https://app.test/settings/accounts?connected=1");
    const acct = await h.db.adAccount.findFirstOrThrow({ where: { accountId: "act_99" } });
    expect(acct.accessToken).not.toContain("EAAB");
    expect(decryptSecret(acct.accessToken, tokenKey)).toBe("EAAB-live-token");
    const listed = (await app.inject({ url: "/ad-accounts", headers: as() })).json();
    expect(JSON.stringify(listed)).not.toContain("accessToken");
  });

  it("only accepts Slack webhook URLs for alerts", async () => {
    const r = await app.inject({ method: "PATCH", url: "/me/notifications", headers: as(), payload: { email: true, inApp: true, slack: true, slackWebhookUrl: "https://evil.test/x" } });
    expect(r.statusCode).toBe(400);
  });
});
