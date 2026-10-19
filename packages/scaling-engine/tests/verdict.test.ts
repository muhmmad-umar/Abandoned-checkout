import { describe, expect, it } from "vitest";
import { aggregateWindow, calculateSystemVerdict, cyclesToGoal } from "../src";
import { brief, days } from "./fixtures";

const metricsAt = (roas: number, conversions = 43, extra: Parameters<typeof days>[1] = {}) =>
  aggregateWindow(days(4, { spend: 1200, revenue: 1200 * roas, conversions, ...extra }), 4);

describe("calculateSystemVerdict", () => {
  it("good tier: recommends +20% in the client's own numbers", () => {
    const v = calculateSystemVerdict(metricsAt(2.1), brief());
    expect(v).toMatchObject({ tier: "good", action: "scale", pct: 20 });
    expect(v.reason).toBe(
      "Your ROAS is 2.1x — 105% of your 2.0x target. You are on pace for your goal. A 20% increase keeps momentum. At this rate you reach 100 orders/day in approximately 5 more cycles.",
    );
  });
  it("strong tier: ROAS ≥ 1.5× target → +30%", () => {
    const v = calculateSystemVerdict(metricsAt(3.2), brief());
    expect(v).toMatchObject({ tier: "strong", pct: 30 });
    expect(v.reason).toContain("160% of your 2.0x target");
  });
  it("borderline: ROAS under target → hold", () => {
    const v = calculateSystemVerdict(metricsAt(1.8), brief());
    expect(v).toMatchObject({ tier: "borderline", action: "hold", pct: 0, cyclesToGoal: null });
    expect(v.reason).toContain("You're at 43 of your 100 orders/day.");
  });
  it("declining: ROAS falling with rising frequency → pause", () => {
    const rows = days(8, { spend: 1200 }, (i) => (i < 4 ? { revenue: 2640, frequency: 2 } : { revenue: 2280, frequency: 3.8 }));
    const v = calculateSystemVerdict(aggregateWindow(rows, 4), brief());
    expect(v).toMatchObject({ tier: "declining", action: "pause", pct: 0 });
    expect(v.reason).toContain("Your ROAS dropped 14% week over week to 1.9x while frequency is rising (3.8)");
  });
  it("declining via creative fatigue share", () => {
    const rows = days(8, { spend: 1200 }, (i) => ({ revenue: i < 4 ? 2640 : 2280 }));
    const v = calculateSystemVerdict(aggregateWindow(rows, 4), brief(), { fatiguedShare: 0.6 });
    expect(v.tier).toBe("declining");
    expect(v.reason).toContain("60% of your creatives show fatigue");
  });
  it("hard stops below the client's ROAS floor", () => {
    const v = calculateSystemVerdict(metricsAt(1.4), brief());
    expect(v).toMatchObject({ tier: "hard_stop", action: "pause" });
    expect(v.reason).toContain("below your 1.5x minimum");
  });
  it("hard stops above the client's CPA ceiling", () => {
    const v = calculateSystemVerdict(metricsAt(2.5, 20), brief()); // CPA 60
    expect(v.tier).toBe("hard_stop");
    expect(v.reason).toContain("$60 — above your $45 ceiling");
  });
  it("drops a tier when CPA is above target CPA", () => {
    const v = calculateSystemVerdict(metricsAt(3.2, 30), brief()); // CPA 40 > 35 target
    expect(v.tier).toBe("good");
    expect(v.reason).toContain("Your CPA of $40 is above your $35 target");
  });
  it("uses the client's preference for step size", () => {
    expect(calculateSystemVerdict(metricsAt(2.1), brief({ scalePreference: "conservative" })).pct).toBe(10);
    expect(calculateSystemVerdict(metricsAt(2.1), brief({ scalePreference: "aggressive" })).pct).toBe(30);
  });
});

describe("cyclesToGoal", () => {
  it("compounds conversions", () => {
    expect(cyclesToGoal(52, 100, 20)).toBe(4);
    expect(cyclesToGoal(100, 100, 20)).toBe(0);
    expect(cyclesToGoal(50, 100, 0)).toBeNull();
  });
});
