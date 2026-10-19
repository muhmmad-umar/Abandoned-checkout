import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateScaling, executeScaling, reconcileStuckExecutions, runCreativeAnalysis, syncPerformance } from "../src";
import { setup, type Harness } from "./harness";

const run = process.env.DATABASE_URL ? describe : describe.skip;

run("campaign lifecycle against Postgres", () => {
  let h: Harness;
  let recId = "";
  beforeAll(async () => {
    h = await setup();
  });
  afterAll(async () => {
    await h?.db.$disconnect();
  });

  it("syncs ads, creative metadata, daily metrics and the live budget", async () => {
    const res = await syncPerformance(h.deps, h.campaignId, 14);
    expect(res).toMatchObject({ ads: 5, snapshots: 70 });
    const c = await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } });
    expect(Number(c.currentDailyBudget)).toBe(1200);
    expect(c.budgetEntityId).toBe("cmp_1");
    const ad = await h.db.ad.findFirstOrThrow({ where: { platformAdId: "ad_u1" } });
    expect(ad).toMatchObject({ format: "video", lengthSec: 12 });
  });

  it("keeps client tags when ads re-sync", async () => {
    await h.db.ad.updateMany({ where: { platformAdId: { in: ["ad_u1", "ad_u2"] } }, data: { format: "ugc", angle: "pain_point", visualStyle: "lifestyle", tone: "emotional" } });
    await h.db.ad.updateMany({ where: { platformAdId: "ad_v1" }, data: { angle: "demo", visualStyle: "product_only" } });
    await h.db.ad.updateMany({ where: { platformAdId: { in: ["ad_s1", "ad_s2"] } }, data: { angle: "offer_led", visualStyle: "text_heavy" } });
    await syncPerformance(h.deps, h.campaignId, 3);
    expect(await h.db.ad.findFirstOrThrow({ where: { platformAdId: "ad_u1" } })).toMatchObject({ format: "ugc", angle: "pain_point" });
  });

  it("Phase 1 writes scores, a creative brief with items, and notifies", async () => {
    const res = await runCreativeAnalysis(h.deps, h.campaignId, "manual");
    expect(res.creativeHealthScore).toBeGreaterThanOrEqual(60);
    const brief = await h.db.creativeBrief.findUniqueOrThrow({ where: { id: res.creativeBriefId }, include: { items: { orderBy: { priority: "asc" } } } });
    expect(brief.headline).toMatch(/^Your top 3 winning patterns are: /);
    expect(brief.headline).toContain("UGC");
    expect(brief.items.length).toBe(res.creativesNeeded);
    expect(brief.items[0]!.status).toBe("pending");
    expect(await h.db.creativeScore.count({ where: { analysisRunId: res.analysisRunId } })).toBe(5);
    if (res.creativesNeeded > 0) {
      const n = await h.db.notification.findFirstOrThrow({ where: { kind: "creative_brief_ready" } });
      expect(n.body).toMatch(/^Your campaign Spring Sale needs \d+ new creatives?\. Your creative brief is ready\. Review it here → https:\/\/app\.test\/campaigns\/.+\?tab=creative-brief$/);
    }
  });

  it("Phase 2 produces a recommendation and waits for the client", async () => {
    const res = await evaluateScaling(h.deps, h.campaignId);
    expect(res.status).toBe("recommend");
    recId = res.recommendationId!;
    const rec = await h.db.scalingRecommendation.findUniqueOrThrow({ where: { id: recId } });
    const d = rec.decision as { verdict: { pct: number; reason: string }; card: { budgetBefore: number; budgetIfApplied: number } };
    expect(d.verdict.pct).toBe(20);
    expect(d.verdict.reason).toMatch(/^Your ROAS is 2\.2x — 108% of your 2\.0x target\./);
    expect(d.card).toMatchObject({ budgetBefore: 1200, budgetIfApplied: 1440 });
    expect((await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } })).scalingState).toBe("awaiting_client");
    expect(h.meta.budgetWrites).toEqual([]); // nothing executed
    expect(await h.db.notification.count({ where: { kind: "recommendation_ready" } })).toBe(1);
  });

  it("does not re-notify when the state is unchanged", async () => {
    const res = await evaluateScaling(h.deps, h.campaignId);
    recId = res.recommendationId!;
    expect(await h.db.notification.count({ where: { kind: "recommendation_ready" } })).toBe(1);
    expect(await h.db.scalingRecommendation.count({ where: { campaignId: h.campaignId, status: "open" } })).toBe(1);
  });

  it("executes the client's override, logging before the API call", async () => {
    const res = await executeScaling(h.deps, { recommendationId: recId, userId: h.userId, clientPct: 30 });
    expect(res).toMatchObject({ ok: true, cycleNumber: 1, budgetBefore: 1200, budgetAfter: 1560 });
    expect(h.meta.budgetWrites).toEqual([1560]);
    const cycle = await h.db.scalingCycle.findFirstOrThrow({ where: { campaignId: h.campaignId } });
    expect(cycle).toMatchObject({ status: "active", overrideFlag: true, earlyTriggerFlag: false });
    expect(Number(cycle.systemRecommendationPct)).toBe(20);
    expect(Number(cycle.clientChosenPct)).toBe(30);
    expect(cycle.cooldownEndsAt.toISOString()).toBe("2026-01-19T12:00:00.000Z");
    const log = await h.db.scalingLog.findFirstOrThrow({ where: { cycleId: cycle.id } });
    expect(log).toMatchObject({ actionType: "budget_change", triggeredBy: "client_override", apiCallStatus: "success" });
    expect(log.newValue).toMatchObject({ dailyBudget: 1560, systemRecommendationPct: 20, clientChosenPct: 30, overrideFlag: true, cycleNumber: 1 });
    const c = await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } });
    expect(c.scalingState).toBe("cooldown");
    expect(Number(c.currentDailyBudget)).toBe(1560);
  });

  it("refuses to apply the same recommendation twice", async () => {
    expect(await executeScaling(h.deps, { recommendationId: recId, userId: h.userId, clientPct: 20 })).toMatchObject({ ok: false, code: "stale" });
  });

  it("refuses another user's recommendation", async () => {
    expect(await executeScaling(h.deps, { recommendationId: recId, userId: "someone_else", clientPct: 20 })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("enforces the cooldown, but lets the client scale early when they insist", async () => {
    h.setNow("2026-01-17T12:00:00Z");
    await syncPerformance(h.deps, h.campaignId, 3);
    const ev = await evaluateScaling(h.deps, h.campaignId);
    expect(ev.status).toBe("cooldown");
    expect(await executeScaling(h.deps, { recommendationId: ev.recommendationId!, userId: h.userId, clientPct: 20 })).toMatchObject({ ok: false, code: "cooldown" });
    const early = await executeScaling(h.deps, { recommendationId: ev.recommendationId!, userId: h.userId, clientPct: 20, earlyOverride: true });
    expect(early).toMatchObject({ ok: true, cycleNumber: 2, budgetBefore: 1560, budgetAfter: 1872 });
    const c2 = await h.db.scalingCycle.findFirstOrThrow({ where: { campaignId: h.campaignId, cycleNumber: 2 } });
    expect(c2).toMatchObject({ earlyTriggerFlag: true, dayOfCooldownWhenTriggered: 2, cooldownLength: 4 });
    // The early override resets the cooldown from now.
    expect(c2.cooldownEndsAt.toISOString()).toBe("2026-01-21T12:00:00.000Z");
    const log = await h.db.scalingLog.findFirstOrThrow({ where: { cycleId: c2.id } });
    expect(log.triggeredBy).toBe("early_override");
    expect(log.newValue).toMatchObject({ earlyOverride: true, dayOfCooldown: 2, cooldownLength: 4 });
  });

  it("evaluates the outcome once the cooldown ends", async () => {
    h.setNow("2026-01-22T12:00:00Z");
    await syncPerformance(h.deps, h.campaignId, 6);
    const ev = await evaluateScaling(h.deps, h.campaignId);
    expect(ev.status).toBe("recommend");
    const cycles = await h.db.scalingCycle.findMany({ where: { campaignId: h.campaignId }, orderBy: { cycleNumber: "asc" } });
    expect(cycles.map((c) => c.status)).toEqual(["completed", "completed"]);
    expect(cycles[1]!.outcomeVsPrediction).toBe("as_expected");
    expect(cycles[0]!.systemNote).toMatch(/^You scaled 30% \(we suggested 20%\)\. ROAS held at 2\.2x\. Your aggressive call paid off this time\.$/);
    const profile = await h.db.clientScalingProfile.findUniqueOrThrow({ where: { campaignId: h.campaignId } });
    expect(profile).toMatchObject({ totalCycles: 2, totalOverrides: 1, overrideOutperformedCount: 1 });
    expect(await h.db.notification.count({ where: { kind: "cycle_outcome" } })).toBe(2);
    recId = ev.recommendationId!;
  });

  it("rolls back gracefully when the platform call fails", async () => {
    const before = await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } });
    h.meta.failNextBudgetWrite = "(#100) Invalid parameter";
    const res = await executeScaling(h.deps, { recommendationId: recId, userId: h.userId, clientPct: 20 });
    expect(res).toMatchObject({ ok: false, code: "platform_error", message: "(#100) Invalid parameter" });
    const failed = await h.db.scalingCycle.findFirstOrThrow({ where: { campaignId: h.campaignId, status: "failed" } });
    expect(failed.cycleNumber).toBe(3);
    const log = await h.db.scalingLog.findFirstOrThrow({ where: { cycleId: failed.id } });
    expect(log).toMatchObject({ apiCallStatus: "failed", errorMessage: "(#100) Invalid parameter" });
    const after = await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } });
    expect(Number(after.currentDailyBudget)).toBe(Number(before.currentDailyBudget));
    expect(after.scalingState).toBe(before.scalingState);
    expect(await h.db.notification.count({ where: { kind: "execution_failed" } })).toBe(1);
    // The recommendation stays open, and a retry takes the same cycle number.
    const retry = await executeScaling(h.deps, { recommendationId: recId, userId: h.userId, clientPct: 20 });
    expect(retry).toMatchObject({ ok: true, cycleNumber: 3 });
  });

  it("reconciles an execution interrupted mid-call", async () => {
    h.setNow("2026-01-27T12:00:00Z");
    const live = (await h.meta.getBudgetTarget()).dailyBudget;
    const prev = await h.db.scalingCycle.findFirstOrThrow({ where: { campaignId: h.campaignId, cycleNumber: 3, status: "active" } });
    const stuck = await h.db.scalingCycle.create({
      data: {
        campaignId: h.campaignId, cycleNumber: 4, status: "executing", earlyTriggerFlag: true,
        startedAt: new Date("2026-01-27T11:00:00Z"), cooldownEndsAt: new Date("2026-01-31T11:00:00Z"),
        budgetBefore: 2000, budgetAfter: live, pctChange: 10, systemRecommendationPct: 20, clientChosenPct: 10,
        overrideFlag: true, triggerMetrics: prev.triggerMetrics as object, systemRationale: "test",
      },
    });
    await h.db.scalingLog.create({ data: { campaignId: h.campaignId, cycleId: stuck.id, actionType: "budget_change", triggeredBy: "client_override" } });
    expect(await reconcileStuckExecutions(h.deps, h.campaignId)).toBe(1);
    expect((await h.db.scalingCycle.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe("active");
    expect((await h.db.scalingLog.findFirstOrThrow({ where: { cycleId: stuck.id } })).apiCallStatus).toBe("success");
  });

  it("detects a ceiling, halts, and re-runs Phase 1", async () => {
    h.setNow("2026-02-04T12:00:00Z");
    h.meta.roasShift = { from: "2026-01-31", factor: 0.72 };
    await syncPerformance(h.deps, h.campaignId, 8);
    h.enqueued.length = 0;
    const ev = await evaluateScaling(h.deps, h.campaignId);
    expect(ev.status).toBe("ceiling");
    expect((await h.db.campaign.findUniqueOrThrow({ where: { id: h.campaignId } })).scalingState).toBe("ceiling");
    expect(h.enqueued).toContainEqual({ kind: "creative", campaignId: h.campaignId, trigger: "ceiling" });
    const n = await h.db.notification.findFirstOrThrow({ where: { kind: "ceiling_detected" } });
    expect(n.body).toContain("Campaign Spring Sale has reached its scaling ceiling.");
    expect(n.body).toMatch(/Your ROAS fell \d+% after the last increase/);
    // The client can still continue past the ceiling if they choose.
    const go = await executeScaling(h.deps, { recommendationId: ev.recommendationId!, userId: h.userId, clientPct: 10, ceilingOverride: true });
    expect(go).toMatchObject({ ok: true, cycleNumber: 5 });
    const c5 = await h.db.scalingCycle.findFirstOrThrow({ where: { campaignId: h.campaignId, cycleNumber: 5 } });
    expect(c5.ceilingOverrideFlag).toBe(true);
  });
});
