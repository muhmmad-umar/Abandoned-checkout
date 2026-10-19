import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cooldownViolation, getPrisma } from "../src";

const run = process.env.DATABASE_URL ? describe : describe.skip;

run("database guards", () => {
  const db = getPrisma();
  let campaignId = "";
  const cycle = (over: Record<string, unknown> = {}) => ({
    campaignId, cycleNumber: 1, status: "active" as const,
    startedAt: new Date("2026-01-10T00:00:00Z"), cooldownEndsAt: new Date("2026-01-14T00:00:00Z"),
    budgetBefore: 1000, budgetAfter: 1200, pctChange: 20, systemRecommendationPct: 20, clientChosenPct: 20,
    overrideFlag: false, triggerMetrics: {}, systemRationale: "test", ...over,
  });

  beforeAll(async () => {
    const user = await db.user.create({ data: { clerkId: `guard_${Date.now()}`, email: `guard_${Date.now()}@x.test` } });
    const acct = await db.adAccount.create({ data: { userId: user.id, platform: "meta", accountId: "act_1", accessToken: "enc" } });
    const c = await db.campaign.create({ data: { userId: user.id, adAccountId: acct.id, platformCampaignId: "c1", name: "Guards" } });
    campaignId = c.id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("rejects a new cycle during cooldown", async () => {
    await db.scalingCycle.create({ data: cycle() });
    const err = await db.scalingCycle
      .create({ data: cycle({ cycleNumber: 2, startedAt: new Date("2026-01-12T00:00:00Z"), cooldownEndsAt: new Date("2026-01-16T00:00:00Z") }) })
      .catch((e) => e);
    expect(cooldownViolation(err)).toBe("cooldown_active");
  });

  it("allows the client's early override and after the window", async () => {
    await expect(db.scalingCycle.create({ data: cycle({ cycleNumber: 2, earlyTriggerFlag: true, startedAt: new Date("2026-01-12T00:00:00Z"), cooldownEndsAt: new Date("2026-01-16T00:00:00Z") }) })).resolves.toBeTruthy();
    await expect(db.scalingCycle.create({ data: cycle({ cycleNumber: 3, startedAt: new Date("2026-01-16T00:00:00Z"), cooldownEndsAt: new Date("2026-01-20T00:00:00Z") }) })).resolves.toBeTruthy();
  });

  it("rejects a second change while one is executing", async () => {
    await db.scalingCycle.create({ data: cycle({ cycleNumber: 4, status: "executing", earlyTriggerFlag: true, startedAt: new Date("2026-01-21T00:00:00Z"), cooldownEndsAt: new Date("2026-01-25T00:00:00Z") }) });
    const err = await db.scalingCycle.create({ data: cycle({ cycleNumber: 5, earlyTriggerFlag: true, startedAt: new Date("2026-01-21T00:00:00Z"), cooldownEndsAt: new Date("2026-01-25T00:00:00Z") }) }).catch((e) => e);
    expect(cooldownViolation(err)).toBe("execution_in_progress");
  });

  it("does not let failed attempts take a cycle number", async () => {
    await db.scalingCycle.updateMany({ where: { campaignId, cycleNumber: 4 }, data: { status: "failed" } });
    await expect(db.scalingCycle.create({ data: cycle({ cycleNumber: 4, earlyTriggerFlag: true, startedAt: new Date("2026-01-21T00:00:00Z"), cooldownEndsAt: new Date("2026-01-25T00:00:00Z") }) })).resolves.toBeTruthy();
  });

  it("keeps scaling_logs append-only", async () => {
    const log = await db.scalingLog.create({ data: { campaignId, actionType: "budget_change", oldValue: { budget: 1000 }, newValue: { budget: 1200 }, triggeredBy: "system" } });
    await expect(db.scalingLog.update({ where: { id: log.id }, data: { newValue: { budget: 9999 } } })).rejects.toThrow(/may only change/);
    await db.scalingLog.update({ where: { id: log.id }, data: { apiCallStatus: "failed", errorMessage: "timeout" } });
    await expect(db.scalingLog.update({ where: { id: log.id }, data: { apiCallStatus: "success" } })).rejects.toThrow(/already resolved/);
    await expect(db.scalingLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
  });
});
