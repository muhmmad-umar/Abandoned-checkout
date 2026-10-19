import { clamp, refreshIntervalDays, round2, type ScalePreference, type ResolvedTargets, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";

const TIER_PCT: Record<ScalePreference, { strong: number; good: number }> = {
  conservative: { strong: 20, good: 10 },
  moderate: { strong: 30, good: 20 },
  aggressive: { strong: 40, good: 30 },
  auto: { strong: 30, good: 20 },
};

const PREF_COOLDOWN: Record<ScalePreference, number> = { conservative: 5, moderate: 4, aggressive: 3, auto: 4 };


/**
 * Fills every blank target in a brief.
 * - Target ROAS: 15% above the client's floor, and never below 1.25x breakeven (1 / margin).
 * - Target CPA: whichever is stricter of 85% of the max acceptable CPA and AOV / target ROAS.
 * - Target budget: target conversions at target CPA, capped at the max budget.
 */
export function resolveTargets(brief: ScalingBrief): ResolvedTargets {
  const breakevenRoas = brief.productMarginPct > 0 ? 1 / brief.productMarginPct : brief.minAcceptableRoas;
  const targetRoas = brief.targetRoas ?? round2(Math.max(brief.minAcceptableRoas * 1.15, breakevenRoas * 1.25));
  const targetCpa =
    brief.targetCpa ?? round2(Math.min(brief.maxAcceptableCpa * 0.85, brief.avgOrderValue / targetRoas));
  const targetDailyBudget =
    brief.targetDailyBudget ?? round2(Math.min(brief.maxBudgetCap, brief.targetDailyConversions * targetCpa));
  return {
    targetRoas,
    targetCpa,
    targetDailyBudget: Math.min(targetDailyBudget, brief.maxBudgetCap),
    targetDailyConversions: brief.targetDailyConversions,
    breakevenRoas: round2(breakevenRoas),
    calculated: { roas: brief.targetRoas == null, cpa: brief.targetCpa == null, budget: brief.targetDailyBudget == null },
  };
}

/** Number of compounding cycles to grow `from` to `to` at `pct` percent per cycle. */
export function cyclesBetween(from: number, to: number, pct: number): number {
  if (from <= 0 || to <= from) return 0;
  if (pct <= 0) return Infinity;
  return Math.ceil(Math.log(to / from) / Math.log(1 + pct / 100) - 1e-9);
}

/**
 * Auto-sets the personalized rules from a brief.
 * Cooldown comes from the scale preference unless a timeline is given, in which case it is
 * stretched or shortened (within 3-5 days) so the planned cycles fit the timeline.
 */
export function deriveThresholds(brief: ScalingBrief): Thresholds {
  const targets = resolveTargets(brief);
  const scalePctByTier = TIER_PCT[brief.scalePreference];
  let cooldownDays = PREF_COOLDOWN[brief.scalePreference];
  if (brief.targetTimelineWeeks && brief.targetTimelineWeeks > 0) {
    const cycles = cyclesBetween(brief.currentDailyBudget, targets.targetDailyBudget, scalePctByTier.good);
    if (cycles > 0 && Number.isFinite(cycles)) {
      cooldownDays = clamp(Math.floor((brief.targetTimelineWeeks * 7) / cycles), 3, 5);
    }
  }
  const minConversions = 50;
  return {
    targets,
    hardStopMinRoas: brief.minAcceptableRoas,
    hardStopMaxCpa: brief.maxAcceptableCpa,
    maxBudgetCap: brief.maxBudgetCap,
    scalePctByTier,
    cooldownDays,
    lookbackDays: clamp(cooldownDays + 2, 3, 7),
    creativeAnalysisIntervalDays: 7,
    creativeBriefCadenceDays: refreshIntervalDays(brief.creativeRefreshFrequency),
    creativeHealthBlockThreshold: 60,
    learningPhase: { minAgeDays: 7, minConversions, minSpend: round2(minConversions * targets.targetCpa * 0.5) },
    ceiling: { cpmIncreasePct: 0.25, roasDropPct: 0.2, cpaOverMaxPct: 0.1, decliningEfficiencyCycles: 3 },
    fatigue: { frequency: 3.5, ctrDeclinePct: 0.15, roasDegradePct: 0.2 },
  };
}
