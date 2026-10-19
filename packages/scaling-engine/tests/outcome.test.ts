import { describe, expect, it } from "vitest";
import { aggregateWindow, buildGoalProgress, buildOverrideHistory, buildScalingProfile, evaluateOutcome, evaluateScaleDecision, projectRoadmap, goalProgressSummary } from "../src";
import { brief, cycle, days, point } from "./fixtures";

const pre = point({ roas: 2.3, dailyConversions: 50 });

describe("evaluateOutcome", () => {
  it("aggressive override that backfired", () => {
    const c = cycle({ budgetBefore: 1000, budgetAfter: 1300, clientChosenPct: 30, overrideFlag: true, preMetrics: pre });
    const r = evaluateOutcome(c, point({ roas: 1.9, dailyConversions: 58 }));
    expect(r).toMatchObject({ outcome: "worse", whoWasRight: "system", roasDelta: -0.4 });
    expect(r.note).toBe("You scaled 30% (we suggested 20%). ROAS dropped 0.4x after the increase. A more conservative approach may serve better next cycle.");
    expect(r.historyLabel).toBe("ROAS dropped 0.4x — system was right");
  });
  it("aggressive override that paid off", () => {
    const c = cycle({ budgetBefore: 1000, budgetAfter: 1300, clientChosenPct: 30, overrideFlag: true, preMetrics: pre });
    const r = evaluateOutcome(c, point({ roas: 2.3, dailyConversions: 65 }));
    expect(r).toMatchObject({ outcome: "as_expected", whoWasRight: "client" });
    expect(r.note).toBe("You scaled 30% (we suggested 20%). ROAS held at 2.3x. Your aggressive call paid off this time.");
    expect(r.historyLabel).toBe("ROAS held — client was right");
  });
  it("cautious override that left room on the table", () => {
    const c = cycle({ budgetBefore: 1000, budgetAfter: 1100, clientChosenPct: 10, overrideFlag: true, preMetrics: pre });
    const r = evaluateOutcome(c, point({ roas: 2.6, dailyConversions: 58 }));
    expect(r).toMatchObject({ outcome: "better", whoWasRight: "system" });
    expect(r.note).toBe("You scaled 10% (we suggested 20%). ROAS rose to 2.6x — there was room for a stronger move.");
  });
  it("followed recommendation", () => {
    const c = cycle({ preMetrics: pre });
    const r = evaluateOutcome(c, point({ roas: 2.3, dailyConversions: 60 }));
    expect(r).toMatchObject({ outcome: "as_expected", whoWasRight: "aligned", note: "ROAS held at 2.3x — on track." });
    expect(r.historyLabel).toBe("ROAS held — on track");
  });
  it("says 'holding' when the system recommended no increase", () => {
    const c = cycle({ systemRecommendationPct: 0, clientChosenPct: 20, overrideFlag: true, preMetrics: pre });
    expect(evaluateOutcome(c, point({ roas: 1.9, dailyConversions: 50 })).note).toMatch(/^You scaled 20% \(we suggested holding\)\./);
    expect(buildOverrideHistory([{ ...c, postMetrics: point() }])[0]!.systemSaid).toBe("Hold");
  });
  it("flags conversions that did not scale with budget", () => {
    const r = evaluateOutcome(cycle({ preMetrics: pre }), point({ roas: 2.3, dailyConversions: 48 }));
    expect(r.outcome).toBe("worse");
  });
});

describe("buildOverrideHistory", () => {
  it("lists each cycle with its outcome", () => {
    const rows = buildOverrideHistory([
      cycle({ cycleNumber: 3, clientChosenPct: 30, overrideFlag: true, budgetAfter: 1300, preMetrics: pre, postMetrics: point({ roas: 1.9, dailyConversions: 58 }) }),
      cycle({ cycleNumber: 4, preMetrics: pre, postMetrics: point({ roas: 2.3, dailyConversions: 60 }) }),
      cycle({ cycleNumber: 5, status: "active" }),
      cycle({ cycleNumber: 6, status: "failed" }),
    ]);
    expect(rows).toEqual([
      { cycle: 3, systemSaid: "+20%", clientChose: "+30%", outcome: "ROAS dropped 0.4x — system was right", early: false },
      { cycle: 4, systemSaid: "+20%", clientChose: "+20%", outcome: "ROAS held — on track", early: false },
      { cycle: 5, systemSaid: "+20%", clientChose: "+20%", outcome: "In cooldown", early: false },
    ]);
  });
});

describe("buildScalingProfile", () => {
  const aggressive = (n: number, held: boolean) =>
    cycle({ cycleNumber: n, clientChosenPct: 30, overrideFlag: true, budgetAfter: 1300, preMetrics: pre,
      postMetrics: point(held ? { roas: 2.3, dailyConversions: 65 } : { roas: 1.9, dailyConversions: 58 }) });
  it("suggests an aggressive profile when bold overrides keep winning", () => {
    const p = buildScalingProfile([aggressive(1, true), aggressive(2, true), aggressive(3, false), aggressive(4, true)]);
    expect(p).toMatchObject({ totalCycles: 4, totalOverrides: 4, overrideOutperformedCount: 3, riskAppetite: "aggressive", avgClientVsSystemDelta: 10 });
    expect(p.insight).toEqual({
      kind: "suggest_aggressive",
      message: "You consistently scale more aggressively than our recommendations. Your overrides have outperformed our suggestions 3 of the last 4 cycles. Want us to update your scaling profile to aggressive?",
    });
  });
  it("suggests following the system when it keeps winning", () => {
    const p = buildScalingProfile([aggressive(1, false), aggressive(2, false), aggressive(3, true)]);
    expect(p.insight?.message).toBe("Our recommendations have outperformed your overrides in 2 of the last 3 cycles. Consider following the system more closely.");
  });
  it("stays quiet before 3 consistent overrides", () => {
    expect(buildScalingProfile([aggressive(1, true), aggressive(2, true)]).insight).toBeNull();
    expect(buildScalingProfile([cycle({ postMetrics: point() })])).toMatchObject({ riskAppetite: "moderate", insight: null });
  });
});

describe("buildGoalProgress", () => {
  const now = new Date("2026-01-14T12:00:00Z");
  const m = aggregateWindow(days(4, { spend: 1800, revenue: 4140, conversions: 67 }), 4);
  const cycles = [1, 2, 3, 4].map((n) => cycle({ cycleNumber: n, startedAt: new Date(`2026-01-${String(n * 3).padStart(2, "0")}T12:00:00Z`), cooldownEndsAt: new Date(`2026-01-${String(n * 3 + 4).padStart(2, "0")}T12:00:00Z`) }));
  it("shows the always-visible header", () => {
    const d = evaluateScaleDecision(m, brief(), cycles, { now, creativeHealthScore: 80, fatiguedShare: 0 });
    const g = buildGoalProgress(brief(), { conversions: 67, spend: 1800, roas: 2.3, cpa: 18.5 }, d, cycles, projectRoadmap(brief(), 20, 4));
    expect(g).toMatchObject({ ordersToday: 67, ordersPct: 0.67, spendPctOfTarget: 0.6, cyclesCompleted: 4, nextWindowInDays: 2, status: "on_track" });
    expect(g.roas.text).toBe("2.3x ✅ above your target (2.0x)");
    expect(g.cpa.text).toBe("$18.50 ✅ below your ceiling ($45)");
    expect(g.statusText).toBe("🟢 On track — scaling as planned");
    expect(goalProgressSummary(g)).toMatch(/^Today: 67 of 100 orders · 4 of ~\d+ cycles · next window in 2 days$/);
  });
  it("flags a ceiling and a reached goal", () => {
    const sat = aggregateWindow(days(4, { spend: 1800, revenue: 4140, conversions: 67, impressions: 100_000, frequency: 2 }), 4);
    const c = [cycle({ preMetrics: point({ cpm: 12 }) })];
    const d = evaluateScaleDecision(sat, brief(), c, { now, creativeHealthScore: 80, fatiguedShare: 0 });
    expect(buildGoalProgress(brief(), { conversions: 67, spend: 1800, roas: 2.3, cpa: 26 }, d, c, []).status).toBe("ceiling");
    const hit = evaluateScaleDecision(aggregateWindow(days(4, { conversions: 100 }), 4), brief(), c, { now, creativeHealthScore: 80, fatiguedShare: 0 });
    expect(buildGoalProgress(brief(), { conversions: 101, spend: 2900, roas: 2.2, cpa: 29 }, hit, c, []).statusText).toContain("🏁 Goal reached");
  });
});
