import { describe, expect, it } from "vitest";
import { creativeTrend, scoreCreatives, windowMetrics } from "../src";
import { campaign, creative } from "./fixtures";

describe("scoreCreatives", () => {
  const ranked = scoreCreatives(campaign());
  it("ranks winners first and scores 0-100", () => {
    expect(ranked.slice(0, 2).map((c) => c.adId)).toEqual(["u1", "u2"]);
    for (const c of ranked.filter((c) => c.score != null)) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
    expect(ranked.find((c) => c.adId === "s2")!.score!).toBeLessThan(ranked.find((c) => c.adId === "u1")!.score!);
  });
  it("leaves creatives without enough data unscored, at the end", () => {
    const tiny = ranked.at(-1)!;
    expect(tiny).toMatchObject({ adId: "tiny", score: null, rank: null, hasEnoughData: false });
  });
  it("assigns ranks to scored creatives", () => {
    expect(ranked.filter((c) => c.rank != null).map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("marks the fatiguing creative as declining", () => {
    expect(ranked.find((c) => c.adId === "f1")!.trend).toBe("declining");
  });
  it("respects custom weights", () => {
    // Weight only CTR: s1 (90 clicks) must beat s2 (80 clicks), regardless of anything else.
    const byCtr = scoreCreatives(campaign(), { weights: { hookRate: 0, ctr: 1, efficiency: 0, completionRate: 0, frequency: 0, costPerResult: 0, trend: 0 } });
    const s = (id: string) => byCtr.find((c) => c.adId === id)!.score!;
    expect(s("s1")).toBeGreaterThan(s("s2"));
    expect(s("u1")).toBe(100);
  });
  it("does not penalise statics for lacking video metrics", () => {
    const pair = scoreCreatives([
      creative("vid", { format: "video" }, { thumbStopRate: 0.1, videoCompletionRate: 0.05 }),
      creative("img", { format: "static" }, {}),
    ]);
    // Same core metrics; the static's score only reflects metrics it has.
    expect(pair.find((c) => c.adId === "img")!.score).toBe(50);
  });
});

describe("windowMetrics / creativeTrend", () => {
  it("weights hook rate by impressions", () => {
    const m = windowMetrics([
      { date: "2026-01-01", spend: 10, impressions: 1000, clicks: 10, conversions: 1, revenue: 20, frequency: 1, thumbStopRate: 0.4 },
      { date: "2026-01-02", spend: 10, impressions: 3000, clicks: 10, conversions: 1, revenue: 20, frequency: 1, thumbStopRate: 0.2 },
    ]);
    expect(m.hookRate).toBeCloseTo(0.25);
    expect(m.completionRate).toBeNull();
  });
  it("classifies trends on ROAS with a ±10% band", () => {
    const base = windowMetrics([{ date: "x", spend: 100, impressions: 1000, clicks: 10, conversions: 1, revenue: 200, frequency: 1 }]);
    const up = { ...base, roas: 2.3 };
    expect(creativeTrend(up, base)).toBe("improving");
    expect(creativeTrend({ ...base, roas: 2.1 }, base)).toBe("stable");
    expect(creativeTrend(base, null)).toBe("stable");
  });
});
