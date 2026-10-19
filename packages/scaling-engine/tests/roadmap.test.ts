import { describe, expect, it } from "vitest";
import { buildRoadmap, projectRoadmap } from "../src";
import { brief } from "./fixtures";

describe("projectRoadmap", () => {
  it("reproduces the spec's 20% / 4-day path, capped at $3,000", () => {
    const cycles = projectRoadmap(brief(), 20, 4);
    expect(cycles.map((c) => Math.round(c.budgetAfter))).toEqual([1200, 1440, 1728, 2074, 2488, 2986, 3000]);
    expect(cycles.map((c) => c.estimatedOrders)).toEqual([36, 43, 52, 62, 75, 90, 90]);
    expect(cycles[6]).toMatchObject({ capped: true, startDay: 24 });
    expect(cycles[5]!.capped).toBe(false);
  });
  it("stops once projected orders reach the target", () => {
    const cycles = projectRoadmap(brief({ targetDailyConversions: 50, targetDailyBudget: null }), 20, 4);
    expect(cycles[cycles.length - 1]!.estimatedOrders).toBeGreaterThanOrEqual(50);
    expect(cycles.length).toBe(3);
  });
  it("applies efficiency decay", () => {
    const flat = projectRoadmap(brief(), 20, 4);
    const decayed = projectRoadmap(brief(), 20, 4, { efficiencyDecayPerCycle: 0.03 });
    expect(decayed[6]!.estimatedOrders).toBeLessThan(flat[6]!.estimatedOrders);
  });
  it("returns nothing for a 0% plan", () => {
    expect(projectRoadmap(brief(), 0, 4)).toEqual([]);
  });
});

describe("buildRoadmap", () => {
  it("summarises the journey and is honest about a shortfall", () => {
    const r = buildRoadmap(brief());
    expect(r.cycles).toHaveLength(7);
    expect(r.estimatedWeeks).toBe(4);
    expect(r.reachesTarget).toBe(false);
    expect(r.notes[0]).toBe("Capped at your max budget of $3,000.");
    expect(r.notes[1]).toBe(
      "At your current efficiency, $3,000/day projects ~90 orders/day — 10 short of your 100 target. Closing the gap needs a CPA near $30 (currently $33.33), which better creatives can unlock.",
    );
    expect(r.notes.at(-1)).toContain("projection, not a guarantee");
  });
  it("writes the creative requirement plan from refresh capacity", () => {
    const r = buildRoadmap(brief());
    expect(r.estimatedCreativesNeeded.min).toBeGreaterThan(0);
    expect(r.estimatedCreativesNeeded.max).toBeGreaterThan(r.estimatedCreativesNeeded.min);
    expect(r.creativePlan).toMatch(/^To reach your target in 7 cycles over ~4 weeks, and given you refresh creatives bi-weekly, you will need approximately \d+-\d+ new creatives/);
  });
  it("weekly refreshers need more creatives than monthly ones", () => {
    const weekly = buildRoadmap(brief({ creativeRefreshFrequency: "weekly" })).estimatedCreativesNeeded.min;
    const monthly = buildRoadmap(brief({ creativeRefreshFrequency: "monthly" })).estimatedCreativesNeeded.min;
    expect(weekly).toBeGreaterThan(monthly);
  });
});
