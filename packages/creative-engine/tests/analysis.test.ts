import { describe, expect, it } from "vitest";
import {
  buildBrief, calculateCreativeHealthScore, calculateCreativesNeeded, detectFatigue, DEFAULT_ANGLES,
  findUntestedAngles, identifyWinningPatterns, recommendedMinimumCreatives, scoreCreatives,
} from "../src";
import { campaign, creative } from "./fixtures";

const fatigueOpts = { healthyRoas: 2, targetCpa: 25, noConversionSpend: 50 };

describe("detectFatigue", () => {
  const f = detectFatigue(campaign(), fatigueOpts);
  it("flags only the fatigued creative", () => {
    expect(f.map((x) => x.adId)).toEqual(["f1"]);
  });
  it("explains each signal in plain language", () => {
    const codes = f[0]!.reasons.map((r) => r.code);
    expect(codes).toEqual(["frequency", "ctr_decline", "roas_degrade"]);
    expect(f[0]!.reasons[0]!.message).toBe("Frequency is 4.2 (above 3.5) and performance is slipping.");
    expect(f[0]!.reasons[1]!.message).toBe("CTR fell 45% week over week (2.00% → 1.10%) despite continued spend.");
    expect(f[0]!.reasons[2]!.message).toBe("ROAS dropped from 3.3x to 1.8x over the last 7 days.");
  });
  it("flags high spend with zero conversions", () => {
    const r = detectFatigue([creative("z", { format: "static" }, { conversions: 0, revenue: 0 })], fatigueOpts);
    expect(r[0]!.reasons).toContainEqual({ code: "spend_no_conversions", message: "Spent $700 this week with no conversions." });
  });
  it("flags high spend with very low conversions", () => {
    const r = detectFatigue([creative("z", { format: "static" }, { spend: 400, conversions: 1, revenue: 50 })], fatigueOpts);
    expect(r[0]!.reasons[0]!.message).toContain("$400 CPA — over 3× your $25 target");
  });
  it("ignores high frequency when performance holds", () => {
    expect(detectFatigue([creative("h", { format: "ugc" }, { frequency: 4 })], fatigueOpts)).toEqual([]);
  });
  it("ignores creatives with no spend this window", () => {
    expect(detectFatigue([creative("off", { format: "static" }, { spend: 0, conversions: 0, revenue: 0 }, {})], fatigueOpts)).toEqual([]);
  });
});

describe("identifyWinningPatterns", () => {
  const p = identifyWinningPatterns(scoreCreatives(campaign()));
  it("finds what the top quartile shares", () => {
    const labels = p.top.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(["UGC", "Pain point angle", "Short-form (<15s)", "Lifestyle visuals", "Emotional tone"]));
    expect(p.topCreativeIds).toEqual(["u1", "u2"]);
    const ugc = p.top.find((x) => x.label === "UGC")!;
    expect(ugc).toMatchObject({ count: 2, quartileSize: 2, share: 1 });
    expect(ugc.lift).toBeCloseTo(7 / 4);
  });
  it("finds what the bottom quartile shares", () => {
    expect(p.losing.map((x) => x.label)).toEqual(expect.arrayContaining(["Static", "Text heavy visuals", "Offer led angle"]));
  });
  it("handles campaigns with nothing scored", () => {
    expect(identifyWinningPatterns([])).toEqual({ top: [], losing: [], topCreativeIds: [] });
  });
});

describe("calculateCreativesNeeded", () => {
  it("replaces fatigued, fills the remaining gap, and adds tests", () => {
    // 6 live, 1 fatigued → 5 healthy. Min 6: replacement covers the gap. +2 untested.
    expect(calculateCreativesNeeded(5, 1, 2, 6)).toBe(3);
    expect(calculateCreativesNeeded(2, 1, 0, 6)).toBe(4);
    expect(calculateCreativesNeeded(8, 0, 0, 6)).toBe(0);
  });
  it("sizes the minimum to the budget", () => {
    expect(recommendedMinimumCreatives(1000, 33)).toBe(7);
    expect(recommendedMinimumCreatives(100, 50)).toBe(3);
    expect(recommendedMinimumCreatives(100_000, 10)).toBe(20);
  });
  it("lists untested angles from the taxonomy", () => {
    expect(findUntestedAngles(DEFAULT_ANGLES, scoreCreatives(campaign()))).toEqual(["ugc", "educational"]);
  });
});

describe("buildBrief", () => {
  const ranked = scoreCreatives(campaign());
  const patterns = identifyWinningPatterns(ranked);
  const fatigued = detectFatigue(campaign(), fatigueOpts);
  const brief = buildBrief(patterns, fatigued, 3, { formatsAvailable: ["static", "video", "ugc"] }, { untestedAngles: ["educational"] });

  it("leads with the top 3 patterns, one per dimension", () => {
    expect(brief.headline).toMatch(/^Your top 3 winning patterns are: /);
    expect(new Set(brief.topPatterns.map((p) => p.dimension)).size).toBe(3);
    expect(brief.summary).toBe("You need 3 new creatives this cycle");
  });
  it("orders cards: replacement, volume, exploration", () => {
    expect(brief.items.map((i) => [i.priority, i.kind])).toEqual([[1, "replacement"], [2, "volume"], [3, "exploration"]]);
    const rep = brief.items[0]!;
    expect(rep).toMatchObject({ suggestedFormat: "ugc", suggestedAngle: "pain_point", suggestedLength: "short", replacesAdId: "f1" });
    expect(rep.rationale).toContain('Replaces "Ad f1" (Frequency is 4.2 (above 3.5) and performance is slipping)');
    expect(rep.whatToAvoid).toMatch(/^Avoid /);
    expect(brief.items[2]).toMatchObject({ kind: "exploration", suggestedAngle: "educational" });
    expect(brief.items[2]!.rationale).toContain("Untested angle");
  });
  it("lists creatives to retire with reasons", () => {
    expect(brief.toRetire).toHaveLength(1);
    expect(brief.toRetire[0]!.reason).toContain("CTR fell 45%");
  });
  it("only suggests formats the client can produce", () => {
    const b = buildBrief(patterns, fatigued, 2, { formatsAvailable: ["static"] });
    expect(b.items.every((i) => i.suggestedFormat === "static")).toBe(true);
    expect(b.items.every((i) => i.suggestedLength === null)).toBe(true);
  });
  it("says so when nothing is needed", () => {
    expect(buildBrief(patterns, [], 0, { formatsAvailable: [] })).toMatchObject({ creativesNeeded: 0, items: [], summary: "Your creative set is healthy — no new creatives needed this cycle" });
  });
});

describe("calculateCreativeHealthScore", () => {
  const now = new Date("2026-01-15T00:00:00Z");
  const ranked = scoreCreatives(campaign());
  const fatigued = detectFatigue(campaign(), fatigueOpts);
  const opts = { now, refreshFrequency: "biweekly" as const, untestedAngleCount: 2 };
  it("is high for a mostly healthy, recently refreshed set", () => {
    const s = calculateCreativeHealthScore(ranked, fatigued, new Date("2026-01-10T00:00:00Z"), opts);
    expect(s).toBeGreaterThanOrEqual(75);
  });
  it("drops when the last refresh is stale", () => {
    const fresh = calculateCreativeHealthScore(ranked, fatigued, new Date("2026-01-10T00:00:00Z"), opts);
    const stale = calculateCreativeHealthScore(ranked, fatigued, new Date("2025-12-01T00:00:00Z"), opts);
    expect(fresh - stale).toBe(20);
  });
  it("falls below 60 when most creatives are fatigued", () => {
    const all = ranked.map((c) => ({ adId: c.adId, name: c.name, spend: 1, reasons: [] }));
    expect(calculateCreativeHealthScore(ranked, all, new Date("2025-12-20T00:00:00Z"), opts)).toBeLessThan(60);
  });
  it("is 0 with no active creatives", () => {
    expect(calculateCreativeHealthScore([], [], null, opts)).toBe(0);
  });
});
