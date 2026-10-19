import { describe, expect, it } from "vitest";
import {
  aggregateWindow, buildOverrideOpinion, cooldownState, evaluateEarlyScaleRequest, evaluateScaleDecision,
  planExecution, ScalingNotAllowedError, type DecisionContext,
} from "../src";
import { brief, cycle, days, point } from "./fixtures";

const now = new Date("2026-01-14T12:00:00Z");
const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({ now, creativeHealthScore: 78, fatiguedShare: 0.1, ...over });
// ROAS 2.1, 43 orders/day at $1,200/day.
const good = aggregateWindow(days(4, { spend: 1200, revenue: 2520, conversions: 43 }), 4);
const prevCycles = [
  cycle({ cycleNumber: 1, startedAt: new Date("2026-01-02T12:00:00Z"), cooldownEndsAt: new Date("2026-01-06T12:00:00Z"), budgetBefore: 1000, budgetAfter: 1200, preMetrics: point({ cpm: 12, roas: 2.1, dailyConversions: 36 }) }),
];

describe("cooldownState", () => {
  it("reports day-of-cooldown and remaining days", () => {
    const c = cycle({ startedAt: new Date("2026-01-12T12:00:00Z"), cooldownEndsAt: new Date("2026-01-17T12:00:00Z") });
    const s = cooldownState([c], now)!;
    expect(s).toMatchObject({ active: true, lengthDays: 5, dayOfCooldown: 2, daysRemaining: 3, message: "Next scaling window opens in 3 days" });
  });
  it("is inactive after the window closes", () => {
    expect(cooldownState(prevCycles, now)!.active).toBe(false);
    expect(cooldownState([], now)).toBeNull();
  });
});

describe("evaluateScaleDecision", () => {
  it("builds the recommendation card", () => {
    const d = evaluateScaleDecision(good, brief(), prevCycles, ctx());
    expect(d.status).toBe("recommend");
    expect(d.card).toEqual({
      cycleNumber: 2, budgetBefore: 1200, budgetIfApplied: 1440, estOrdersAfter: 52, targetOrders: 100,
      totalCyclesEstimate: 6, options: [10, 20, 30], defaultPct: 20,
    });
    expect(d.message).toBe(d.verdict.reason);
  });
  it("prefers the live platform budget", () => {
    expect(evaluateScaleDecision(good, brief(), prevCycles, ctx({ currentDailyBudget: 1250 })).card.budgetBefore).toBe(1250);
  });
  it("is in cooldown while the last cycle's window is open", () => {
    const c = cycle({ startedAt: new Date("2026-01-12T12:00:00Z"), cooldownEndsAt: new Date("2026-01-16T12:00:00Z") });
    expect(evaluateScaleDecision(good, brief(), [c], ctx()).status).toBe("cooldown");
  });
  it("is blocked when creative health is low", () => {
    const d = evaluateScaleDecision(good, brief(), prevCycles, ctx({ creativeHealthScore: 40 }));
    expect(d.status).toBe("blocked");
    expect(d.message).toContain("creative health score is 40/100");
  });
  it("halts at a ceiling", () => {
    const saturated = aggregateWindow(days(4, { spend: 1200, revenue: 2520, conversions: 43, impressions: 70_000 }), 4);
    expect(evaluateScaleDecision(saturated, brief(), prevCycles, ctx()).status).toBe("ceiling");
  });
  it("detects goal reached", () => {
    const hit = aggregateWindow(days(4, { spend: 3000, revenue: 6300, conversions: 100 }), 4);
    expect(evaluateScaleDecision(hit, brief(), prevCycles, ctx()).status).toBe("goal_reached");
  });
  it("hard stops at the max budget cap", () => {
    const d = evaluateScaleDecision(good, brief(), prevCycles, ctx({ currentDailyBudget: 3000 }));
    expect(d.status).toBe("hard_stop");
    expect(d.message).toContain("$3,000");
  });
});

describe("buildOverrideOpinion", () => {
  const v = evaluateScaleDecision(good, brief(), prevCycles, ctx()).verdict;
  it("says nothing when the client agrees", () => {
    expect(buildOverrideOpinion(v, 20, good, brief(), 4)).toBeNull();
  });
  it("one inline opinion when the client goes bigger", () => {
    expect(buildOverrideOpinion(v, 30, good, brief(), 4)).toBe(
      "We'd recommend 20% here. A 30% jump after 4 days of data may shock the algorithm before it stabilizes. Proceeding with your choice of 30%.",
    );
  });
  it("one inline opinion when the client goes smaller", () => {
    expect(buildOverrideOpinion(v, 10, good, brief(), 4)).toBe(
      "We'd recommend 20% — your metrics support a stronger move. 10% is safe but may slow your path to 100 orders/day. Proceeding with your choice of 10%.",
    );
  });
  it("explains a hold in the client's numbers", () => {
    const weak = aggregateWindow(days(4, { spend: 1200, revenue: 2160, conversions: 43 }), 4);
    const hv = evaluateScaleDecision(weak, brief(), prevCycles, ctx()).verdict;
    expect(buildOverrideOpinion(hv, 20, weak, brief(), 4)).toBe(
      "We'd recommend holding this cycle — your ROAS is 1.8x, under your 2.0x target, so added spend is likely to buy less efficiently. Proceeding with your choice of 20%.",
    );
  });
});

describe("evaluateEarlyScaleRequest", () => {
  it("builds the Day 2 of 5 card", () => {
    const c = cycle({ startedAt: new Date("2026-01-12T12:00:00Z"), cooldownEndsAt: new Date("2026-01-17T12:00:00Z") });
    const d = evaluateScaleDecision(good, brief(), [c], ctx());
    const card = evaluateEarlyScaleRequest(d, good, brief(), now);
    expect(card).toMatchObject({ dayOfCooldown: 2, cooldownLength: 5, daysRemaining: 3, verdict: "Wait until Day 5 (3 more days)" });
    expect(card.reason).toBe(
      "It has been 48 hours since the last increase. Meta's algorithm typically needs 3-5 days to stabilize after a budget change. Scaling now means reading noisy data — you may increase budget into a temporary dip.",
    );
    expect(card.metrics).toMatchObject({ trend: "stabilizing", ordersToday: 43, targetOrders: 100 });
  });
  it("refuses outside a cooldown", () => {
    const d = evaluateScaleDecision(good, brief(), prevCycles, ctx());
    expect(() => evaluateEarlyScaleRequest(d, good, brief(), now)).toThrow();
  });
});

describe("planExecution", () => {
  const d = evaluateScaleDecision(good, brief(), prevCycles, ctx());
  it("plans the client's choice and logs the override", () => {
    const p = planExecution(d, brief(), { clientPct: 30, now });
    expect(p).toMatchObject({
      cycleNumber: 2, budgetBefore: 1200, budgetAfter: 1560, pctChange: 30,
      systemRecommendationPct: 20, clientChosenPct: 30, overrideFlag: true, earlyTriggerFlag: false, cappedAtMax: false,
    });
    expect(p.cooldownEndsAt.toISOString()).toBe("2026-01-18T12:00:00.000Z");
  });
  it("never exceeds the max budget cap, even on override", () => {
    const p = planExecution(evaluateScaleDecision(good, brief(), prevCycles, ctx({ currentDailyBudget: 2800 })), brief(), { clientPct: 30, now });
    expect(p).toMatchObject({ budgetAfter: 3000, cappedAtMax: true });
    expect(p.pctChange).toBeCloseTo(7.14, 2);
  });
  it("requires an explicit early override during cooldown, then logs it", () => {
    const c = cycle({ startedAt: new Date("2026-01-12T12:00:00Z"), cooldownEndsAt: new Date("2026-01-17T12:00:00Z") });
    const cd = evaluateScaleDecision(good, brief(), [c], ctx());
    expect(() => planExecution(cd, brief(), { clientPct: 20, now })).toThrow(ScalingNotAllowedError);
    expect(planExecution(cd, brief(), { clientPct: 20, now, earlyOverride: true })).toMatchObject({
      earlyTriggerFlag: true, dayOfCooldownWhenTriggered: 2, cooldownLength: 5,
    });
  });
  it("lets the client continue past a ceiling only when asked", () => {
    const saturated = aggregateWindow(days(4, { spend: 1200, revenue: 2520, conversions: 43, impressions: 70_000 }), 4);
    const cd = evaluateScaleDecision(saturated, brief(), prevCycles, ctx());
    expect(() => planExecution(cd, brief(), { clientPct: 20, now })).toThrow(/ceiling/);
    expect(planExecution(cd, brief(), { clientPct: 20, now, ceilingOverride: true }).budgetAfter).toBe(1440);
  });
  it("respects blocks, hard stops and blackout even during an early override", () => {
    const c = cycle({ startedAt: new Date("2026-01-12T12:00:00Z"), cooldownEndsAt: new Date("2026-01-17T12:00:00Z") });
    const blocked = evaluateScaleDecision(good, brief({ blackoutDates: ["2026-01-14"] }), [c], ctx());
    expect(() => planExecution(blocked, brief(), { clientPct: 20, now, earlyOverride: true })).toThrow(/blackout/);
    const blockedNow = evaluateScaleDecision(good, brief(), prevCycles, ctx({ creativeHealthScore: 30 }));
    expect(() => planExecution(blockedNow, brief(), { clientPct: 20, now })).toThrow(ScalingNotAllowedError);
  });
  it("validates the percentage", () => {
    expect(() => planExecution(d, brief(), { clientPct: 0, now })).toThrow(/between 1% and 100%/);
    expect(() => planExecution(d, brief(), { clientPct: 150, now })).toThrow();
  });
});
