import { describe, expect, it } from "vitest";
import { aggregateWindow, calculateScalingHealthScore, detectCeiling, scalingHealthLabel, shouldBlockScaling } from "../src";
import { brief, cycle, days, point } from "./fixtures";

const now = new Date("2026-01-14T15:00:00Z");
const ok = { now, conversionsLast7d: 300, fatiguedShare: 0.1 };

describe("shouldBlockScaling", () => {
  it("passes a healthy, mature campaign", () => {
    expect(shouldBlockScaling(75, 30, 7000, brief(), ok)).toEqual({ blocked: false, reasons: [] });
  });
  it("blocks on creative health below 60 with the spec's message", () => {
    const r = shouldBlockScaling(52, 30, 7000, brief(), ok);
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toEqual({
      code: "creative_health",
      message: "Budget scaling is paused. Your creative health score is 52/100. Upload new creatives from your brief before the next scaling cycle.",
    });
  });
  it("blocks during the learning phase and says what is missing", () => {
    const r = shouldBlockScaling(80, 4, 7000, brief(), { ...ok, conversionsLast7d: 20 });
    expect(r.reasons.map((x) => x.code)).toEqual(["learning_phase"]);
    expect(r.reasons[0]!.message).toContain("4 of 7 days live, 20 of 50 conversions this week");
  });
  it("blocks when most creatives are fatigued", () => {
    expect(shouldBlockScaling(80, 30, 7000, brief(), { ...ok, fatiguedShare: 0.6 }).reasons[0]!.code).toBe("fatigue");
  });
  it("blocks on blackout dates in the account time zone", () => {
    const b = brief({ blackoutDates: ["2026-01-14"] });
    expect(shouldBlockScaling(80, 30, 7000, b, ok).reasons[0]!.code).toBe("blackout");
    // 15:00 UTC on the 14th is still the 14th in LA, but 01:00 UTC on the 15th is the 14th in LA too.
    const lateNow = new Date("2026-01-15T01:00:00Z");
    expect(shouldBlockScaling(80, 30, 7000, b, { ...ok, now: lateNow }).blocked).toBe(false);
    expect(shouldBlockScaling(80, 30, 7000, b, { ...ok, now: lateNow, timeZone: "America/Los_Angeles" }).blocked).toBe(true);
  });
});

describe("detectCeiling", () => {
  const healthy = aggregateWindow(days(4), 4);
  it("does not fire on stable metrics", () => {
    expect(detectCeiling([cycle()], healthy, brief())).toEqual({ detected: false, reasons: [], alert: null });
  });
  it("fires on CPM saturation after the last scale", () => {
    const m = aggregateWindow(days(4, { impressions: 75_000 }), 4); // CPM 13.33 vs 10
    const r = detectCeiling([cycle()], m, brief());
    expect(r.detected).toBe(true);
    expect(r.reasons[0]!.code).toBe("cpm_saturation");
    expect(r.reasons[0]!.message).toBe("Your CPM rose 33% since the last increase ($10 → $13.33) — your audience is saturating at this budget.");
    expect(r.alert).toContain("reached its scaling ceiling");
  });
  it("fires on a ROAS drop after the last scale", () => {
    const m = aggregateWindow(days(4, { revenue: 1500 }), 4); // 2.1 → 1.5 (-29%)
    expect(detectCeiling([cycle()], m, brief()).reasons.map((r) => r.code)).toContain("roas_drop");
  });
  it("fires on CPA more than 10% over the client's max", () => {
    const m = aggregateWindow(days(4, { conversions: 19 }), 4); // CPA 52.6 > 49.5
    expect(detectCeiling([cycle()], m, brief()).reasons.map((r) => r.code)).toContain("cpa_over_max");
  });
  it("fires on rising frequency with falling CTR, even before any cycle", () => {
    const m = aggregateWindow(days(8, {}, (i) => (i >= 4 ? { frequency: 3, clicks: 1200 } : {})), 4);
    expect(detectCeiling([], m, brief()).reasons.map((r) => r.code)).toEqual(["frequency_ctr"]);
  });
  it("fires after N consecutive cycles of declining efficiency", () => {
    const dec = (n: number) => cycle({ cycleNumber: n, preMetrics: point({ efficiency: 0.05 }), postMetrics: point({ efficiency: 0.045 }) });
    expect(detectCeiling([dec(1), dec(2)], healthy, brief()).detected).toBe(false);
    expect(detectCeiling([dec(1), dec(2), dec(3)], healthy, brief()).reasons.map((r) => r.code)).toEqual(["declining_efficiency"]);
  });
  it("ignores failed cycles", () => {
    const m = aggregateWindow(days(4, { impressions: 75_000 }), 4);
    expect(detectCeiling([cycle({ status: "failed" })], m, brief()).detected).toBe(false);
  });
});

describe("calculateScalingHealthScore", () => {
  it("scores 100 for flat, healthy metrics", () => {
    expect(calculateScalingHealthScore([cycle()], aggregateWindow(days(4), 4))).toBe(100);
  });
  it("falls as ROAS, CPM, CPA and frequency degrade", () => {
    const m = aggregateWindow(days(4, { revenue: 1680, impressions: 80_000, conversions: 42, frequency: 3.5 }), 4);
    const score = calculateScalingHealthScore([cycle()], m);
    expect(score).toBeLessThan(60);
    expect(score).toBeGreaterThan(20);
  });
  it("bottoms out at a ceiling", () => {
    const m = aggregateWindow(days(4, { revenue: 1000, impressions: 60_000, conversions: 30, frequency: 4.5 }), 4);
    expect(scalingHealthLabel(calculateScalingHealthScore([cycle()], m))).toBe("ceiling");
  });
  it("labels bands", () => {
    expect([85, 70, 45, 10].map(scalingHealthLabel)).toEqual(["scaling_freely", "healthy", "caution", "ceiling"]);
  });
});
