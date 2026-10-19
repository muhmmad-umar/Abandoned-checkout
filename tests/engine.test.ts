import { describe, expect, it } from "vitest";
import { evaluate } from "../src/rules/engine.js";
import { DEFAULT_GUARDRAILS, type EvaluationInput, type Rule } from "../src/rules/types.js";
import { toSnapshot } from "../src/meta/types.js";

const now = new Date("2026-01-10T12:00:00Z");
const base = (over: Partial<EvaluationInput> = {}, spend = 5000, value = 15000): EvaluationInput => ({
  adSet: { id: "1", campaignId: "c", name: "a", status: "ACTIVE", dailyBudget: 10_000 },
  metrics: toSnapshot({ spend, impressions: 10000, clicks: 200, purchases: 10, purchaseValue: value }),
  lastFired: {},
  increasedPercentLast24h: 0,
  now,
  ...over,
});

const scale: Rule = {
  id: "scale", name: "scale winners", cooldownHours: 24,
  conditions: [{ metric: "roas", op: ">=", value: 2 }],
  action: { type: "INCREASE_BUDGET", percent: 20 },
};
const kill: Rule = {
  id: "kill", name: "kill losers", cooldownHours: 0,
  conditions: [{ metric: "roas", op: "<", value: 1 }],
  action: { type: "PAUSE" },
};

describe("evaluate", () => {
  it("increases budget on a winner", () => {
    expect(evaluate([scale], base(), DEFAULT_GUARDRAILS)).toEqual([
      { kind: "SET_BUDGET", ruleId: "scale", adSetId: "1", from: 10_000, to: 12_000 },
    ]);
  });
  it("pauses a loser", () => {
    const d = evaluate([kill], base({}, 5000, 2000), DEFAULT_GUARDRAILS);
    expect(d).toEqual([{ kind: "PAUSE", ruleId: "kill", adSetId: "1" }]);
  });
  it("skips when spend is too low to judge", () => {
    const d = evaluate([scale], base({}, 500, 3000), DEFAULT_GUARDRAILS);
    expect(d[0]).toMatchObject({ kind: "SKIP", reason: "insufficient spend" });
  });
  it("respects cooldown", () => {
    const d = evaluate([scale], base({ lastFired: { scale: new Date("2026-01-10T00:00:00Z") } }), DEFAULT_GUARDRAILS);
    expect(d[0]).toMatchObject({ kind: "SKIP", reason: "cooldown" });
  });
  it("caps increases at the 24h limit", () => {
    const d = evaluate([scale], base({ increasedPercentLast24h: 15 }), DEFAULT_GUARDRAILS);
    expect(d[0]).toMatchObject({ kind: "SET_BUDGET", to: 10_500 });
  });
  it("never exceeds the max daily budget", () => {
    const d = evaluate([scale], base(), { ...DEFAULT_GUARDRAILS, maxDailyBudget: 11_000 });
    expect(d[0]).toMatchObject({ kind: "SET_BUDGET", to: 11_000 });
  });
  it("never matches CPA conditions with zero purchases", () => {
    const input = base();
    input.metrics = toSnapshot({ spend: 5000, impressions: 1, clicks: 1, purchases: 0, purchaseValue: 0 });
    const r: Rule = { ...scale, id: "cpa", conditions: [{ metric: "cpa", op: "<", value: 100 }] };
    expect(evaluate([r], input, DEFAULT_GUARDRAILS)).toEqual([]);
  });
  it("ignores paused ad sets", () => {
    const input = base();
    input.adSet.status = "PAUSED";
    expect(evaluate([scale], input, DEFAULT_GUARDRAILS)).toEqual([]);
  });
});
