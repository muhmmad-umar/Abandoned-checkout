import { fmtCount, fmtMoney, fmtPct, fmtRoas, plural, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { cyclesBetween, deriveThresholds } from "./targets";
import type { ScalingMetrics, SystemVerdict, VerdictTier } from "./types";

export interface VerdictOptions {
  thresholds?: Thresholds;
  /** Share of active creatives flagged as fatigued (0-1). */
  fatiguedShare?: number;
}

/**
 * Number of compounding scale cycles needed to lift daily conversions to the target,
 * assuming conversions grow proportionally with budget.
 */
export function cyclesToGoal(currentConversions: number, targetConversions: number, pct: number): number | null {
  if (currentConversions >= targetConversions) return 0;
  if (pct <= 0 || currentConversions <= 0) return null;
  return cyclesBetween(currentConversions, targetConversions, pct);
}

/**
 * Calculates the system's recommendation, tiered against the client's own targets:
 * - hard_stop: ROAS below the client's floor or CPA above their ceiling → pause
 * - declining: ROAS down ≥10% week over week while frequency rises or most creatives fatigue → pause
 * - strong: ROAS ≥ 1.5× target → the preference's strong step (+30% moderate)
 * - good: ROAS ≥ target → the preference's good step (+20% moderate)
 * - borderline: ROAS below target → hold
 * A CPA above the client's target CPA drops strong/good by one tier.
 * @returns the verdict with a reason written in the client's numbers
 */
export function calculateSystemVerdict(
  metrics: ScalingMetrics,
  brief: ScalingBrief,
  opts: VerdictOptions = {},
): SystemVerdict {
  const t = opts.thresholds ?? deriveThresholds(brief);
  const { targetRoas, targetCpa, targetDailyConversions } = t.targets;
  const roasVsTarget = targetRoas > 0 ? metrics.roas / targetRoas : 0;
  const roasLine = `Your ROAS is ${fmtRoas(metrics.roas)} — ${fmtPct(roasVsTarget)} of your ${fmtRoas(targetRoas)} target.`;
  const ordersLine = `You're at ${fmtCount(metrics.dailyConversions)} of your ${fmtCount(targetDailyConversions)} orders/day.`;

  const make = (tier: VerdictTier, action: SystemVerdict["action"], pct: number, reason: string): SystemVerdict => ({
    tier,
    action,
    pct,
    reason,
    roasVsTarget,
    cyclesToGoal: action === "scale" ? cyclesToGoal(metrics.dailyConversions, targetDailyConversions, pct) : null,
  });

  if (metrics.roas < t.hardStopMinRoas) {
    return make("hard_stop", "pause", 0,
      `Your ROAS is ${fmtRoas(metrics.roas)} — below your ${fmtRoas(t.hardStopMinRoas)} minimum. Scaling is stopped until it recovers above your floor.`);
  }
  if (metrics.cpa != null && metrics.cpa > t.hardStopMaxCpa) {
    return make("hard_stop", "pause", 0,
      `Your CPA is ${fmtMoney(metrics.cpa)} — above your ${fmtMoney(t.hardStopMaxCpa)} ceiling. Scaling is stopped until it comes back under.`);
  }

  const roasFalling = metrics.roasDeltaWoW != null && metrics.roasDeltaWoW <= -0.1;
  const fatigueRising = metrics.frequencyTrend === "up" || (opts.fatiguedShare ?? 0) >= 0.5;
  if (roasFalling && fatigueRising) {
    const signal = metrics.frequencyTrend === "up"
      ? `frequency is rising (${metrics.frequency.toFixed(1)})`
      : `${fmtPct(opts.fatiguedShare ?? 0)} of your creatives show fatigue`;
    return make("declining", "pause", 0,
      `Your ROAS dropped ${fmtPct(-metrics.roasDeltaWoW!)} week over week to ${fmtRoas(metrics.roas)} while ${signal}. That points to creative fatigue — pause scaling and refresh creatives before the next increase.`);
  }

  let tier: VerdictTier = roasVsTarget >= 1.5 ? "strong" : roasVsTarget >= 1 ? "good" : "borderline";
  const cpaOver = metrics.cpa != null && metrics.cpa > targetCpa;
  if (cpaOver && tier !== "borderline") tier = tier === "strong" ? "good" : "borderline";
  const cpaNote = cpaOver ? ` Your CPA of ${fmtMoney(metrics.cpa!)} is above your ${fmtMoney(targetCpa)} target, so we're stepping down one notch.` : "";

  if (tier === "borderline") {
    return make("borderline", "hold", 0,
      `${roasLine}${cpaNote} Holding budget this cycle lets performance settle before adding spend. ${ordersLine}`);
  }

  const pct = t.scalePctByTier[tier];
  const cycles = cyclesToGoal(metrics.dailyConversions, targetDailyConversions, pct);
  const pace = cycles == null
    ? ""
    : cycles === 0
      ? ` You've reached your ${fmtCount(targetDailyConversions)} orders/day goal.`
      : ` At this rate you reach ${fmtCount(targetDailyConversions)} orders/day in approximately ${plural(cycles, "more cycle", "more cycles")}.`;
  const body = tier === "strong"
    ? ` You're well ahead of pace — there's room for a stronger move. A ${pct}% increase accelerates your path.`
    : ` You are on pace for your goal. A ${pct}% increase keeps momentum.`;
  return make(tier, "scale", pct, `${roasLine}${cpaNote}${body}${pace}`);
}
