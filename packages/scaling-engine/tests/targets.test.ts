import { describe, expect, it } from "vitest";
import { cyclesBetween, deriveThresholds, resolveTargets } from "../src";
import { brief } from "./fixtures";

describe("resolveTargets", () => {
  it("keeps targets the client supplied", () => {
    const r = resolveTargets(brief());
    expect(r).toMatchObject({ targetRoas: 2, targetCpa: 35, targetDailyBudget: 3000, calculated: { roas: false, cpa: false, budget: false } });
  });
  it("calculates blank targets from constraints and margin", () => {
    const r = resolveTargets(brief({ targetRoas: null, targetCpa: null, targetDailyBudget: null, productMarginPct: 0.4 }));
    // breakeven 2.5x → target max(1.5*1.15, 2.5*1.25) = 3.13
    expect(r.breakevenRoas).toBe(2.5);
    expect(r.targetRoas).toBe(3.13);
    // min(45*0.85, 70/3.13) = 22.36
    expect(r.targetCpa).toBe(22.36);
    expect(r.targetDailyBudget).toBe(2236);
    expect(r.calculated).toEqual({ roas: true, cpa: true, budget: true });
  });
  it("never sets a target budget above the cap", () => {
    expect(resolveTargets(brief({ targetDailyBudget: 9000 })).targetDailyBudget).toBe(3000);
  });
});

describe("deriveThresholds", () => {
  it("maps hard stops straight from the client's constraints", () => {
    const t = deriveThresholds(brief());
    expect(t).toMatchObject({ hardStopMinRoas: 1.5, hardStopMaxCpa: 45, maxBudgetCap: 3000, cooldownDays: 4 });
  });
  it("matches scale % to preference", () => {
    expect(deriveThresholds(brief({ scalePreference: "conservative" })).scalePctByTier).toEqual({ strong: 20, good: 10 });
    expect(deriveThresholds(brief({ scalePreference: "aggressive" })).scalePctByTier).toEqual({ strong: 40, good: 30 });
  });
  it("fits cooldown to the timeline within 3-5 days", () => {
    // 1000→3000 at 20% = 7 cycles. 4 weeks = 28 days → 4/cycle. 2 weeks → clamped to 3.
    expect(deriveThresholds(brief({ targetTimelineWeeks: 4 })).cooldownDays).toBe(4);
    expect(deriveThresholds(brief({ targetTimelineWeeks: 2 })).cooldownDays).toBe(3);
    expect(deriveThresholds(brief({ targetTimelineWeeks: 12 })).cooldownDays).toBe(5);
  });
  it("matches creative brief cadence to refresh capacity", () => {
    expect(deriveThresholds(brief({ creativeRefreshFrequency: "weekly" })).creativeBriefCadenceDays).toBe(7);
    expect(deriveThresholds(brief()).creativeBriefCadenceDays).toBe(14);
  });
});

describe("cyclesBetween", () => {
  it("counts compounding steps", () => {
    expect(cyclesBetween(1000, 3000, 20)).toBe(7);
    expect(cyclesBetween(1000, 1200, 20)).toBe(1);
    expect(cyclesBetween(1000, 900, 20)).toBe(0);
  });
});
