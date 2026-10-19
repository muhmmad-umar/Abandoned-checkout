import { fmtCount, fmtMoney, refreshIntervalDays, round2, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { deriveThresholds } from "./targets";

export interface RoadmapCycle {
  cycle: number;
  budgetBefore: number;
  budgetAfter: number;
  estimatedOrders: number;
  /** True when this step was limited by the client's max budget cap. */
  capped: boolean;
  startDay: number;
}

export interface RoadmapOptions {
  /** Fractional loss of conversions-per-dollar per cycle (0.02 = 2%). Default 0. */
  efficiencyDecayPerCycle?: number;
  maxCycles?: number;
}

/**
 * Projects the budget path from the brief's current state to its target.
 * Budget compounds by `scalePct` each cycle and stops at the target budget, the max cap, or when
 * projected orders reach the target. Orders scale with budget at the current orders-per-dollar,
 * less `efficiencyDecayPerCycle` compounded.
 */
export function projectRoadmap(
  clientBrief: ScalingBrief,
  scalePct: number,
  cooldownDays: number,
  opts: RoadmapOptions = {},
): RoadmapCycle[] {
  if (scalePct <= 0) return [];
  const t = deriveThresholds(clientBrief);
  const decay = opts.efficiencyDecayPerCycle ?? 0;
  const maxCycles = opts.maxCycles ?? 52;
  const ceiling = Math.min(t.targets.targetDailyBudget, clientBrief.maxBudgetCap);
  const ordersPerDollar = clientBrief.currentDailyBudget > 0 ? clientBrief.currentDailyConversions / clientBrief.currentDailyBudget : 0;

  const out: RoadmapCycle[] = [];
  let budget = clientBrief.currentDailyBudget;
  let orders = clientBrief.currentDailyConversions;
  for (let i = 1; i <= maxCycles && budget < ceiling && orders < clientBrief.targetDailyConversions; i++) {
    const raw = budget * (1 + scalePct / 100);
    const next = Math.min(raw, ceiling);
    orders = next * ordersPerDollar * (1 - decay) ** i;
    out.push({
      cycle: i,
      budgetBefore: round2(budget),
      budgetAfter: round2(next),
      estimatedOrders: Math.round(orders),
      capped: raw > clientBrief.maxBudgetCap && next === clientBrief.maxBudgetCap,
      startDay: (i - 1) * cooldownDays,
    });
    budget = next;
  }
  return out;
}

/**
 * Estimates the creatives the journey will consume: one refresh batch (40% of the live set, min 2)
 * per refresh interval, plus extra volume as budget grows (a quarter of the live set per doubling).
 * @returns an inclusive range
 */
export function estimateCreativesForRoadmap(
  clientBrief: ScalingBrief,
  weeks: number,
  finalBudget: number,
): { min: number; max: number } {
  const intervalWeeks = refreshIntervalDays(clientBrief.creativeRefreshFrequency) / 7;
  const refreshes = Math.max(1, Math.ceil(weeks / intervalWeeks));
  const live = Math.max(clientBrief.activeCreativeCount, 1);
  const batch = Math.max(2, Math.ceil(live * 0.4));
  const growth = Math.max(0, finalBudget / Math.max(clientBrief.currentDailyBudget, 1) - 1);
  const n = refreshes * batch + Math.ceil(live * growth * 0.25);
  return { min: Math.max(1, Math.round(n * 0.9)), max: Math.ceil(n * 1.25) };
}

export interface ScalingRoadmap {
  start: { dailyBudget: number; dailyOrders: number };
  target: { dailyBudget: number; dailyOrders: number };
  scalePct: number;
  cooldownDays: number;
  cycles: RoadmapCycle[];
  estimatedWeeks: number;
  estimatedCreativesNeeded: { min: number; max: number };
  reachesTarget: boolean;
  projectedFinalOrders: number;
  /** Client-facing notes, e.g. a shortfall explanation. */
  notes: string[];
  creativePlan: string;
  assumptions: { ordersPerDollar: number; efficiencyDecayPerCycle: number; cyclePlanningPct: number };
}

/** Builds the full Scaling Roadmap shown after a brief is submitted, before any automation runs. */
export function buildRoadmap(clientBrief: ScalingBrief, thresholds?: Thresholds, opts: RoadmapOptions = {}): ScalingRoadmap {
  const t = thresholds ?? deriveThresholds(clientBrief);
  const pct = t.scalePctByTier.good;
  const cycles = projectRoadmap(clientBrief, pct, t.cooldownDays, opts);
  const last = cycles[cycles.length - 1];
  const finalOrders = last?.estimatedOrders ?? clientBrief.currentDailyConversions;
  const finalBudget = last?.budgetAfter ?? clientBrief.currentDailyBudget;
  const estimatedWeeks = Math.round(((cycles.length * t.cooldownDays) / 7) * 10) / 10;
  const target = clientBrief.targetDailyConversions;
  const reachesTarget = finalOrders >= target;
  const creatives = estimateCreativesForRoadmap(clientBrief, Math.max(estimatedWeeks, 1), finalBudget);

  const notes: string[] = [];
  if (last?.capped) notes.push(`Capped at your max budget of ${fmtMoney(clientBrief.maxBudgetCap)}.`);
  if (!reachesTarget) {
    const neededCpa = finalBudget / target;
    const currentCpa = clientBrief.currentDailyConversions > 0 ? clientBrief.currentDailyBudget / clientBrief.currentDailyConversions : null;
    notes.push(
      `At your current efficiency, ${fmtMoney(finalBudget)}/day projects ~${fmtCount(finalOrders)} orders/day — ${fmtCount(target - finalOrders)} short of your ${fmtCount(target)} target. Closing the gap needs a CPA near ${fmtMoney(neededCpa)}${currentCpa ? ` (currently ${fmtMoney(currentCpa)})` : ""}, which better creatives can unlock.`,
    );
  }
  notes.push("This roadmap adapts at each cycle based on real data. It is a projection, not a guarantee.");

  const cadence = { weekly: "weekly", biweekly: "bi-weekly", monthly: "monthly", adhoc: "as needed" }[clientBrief.creativeRefreshFrequency];
  const creativePlan = `To reach your target in ${cycles.length} cycles over ~${Math.ceil(estimatedWeeks)} weeks, and given you refresh creatives ${cadence}, you will need approximately ${creatives.min}-${creatives.max} new creatives over this journey. We will brief them in batches as the campaign progresses.`;

  return {
    start: { dailyBudget: clientBrief.currentDailyBudget, dailyOrders: clientBrief.currentDailyConversions },
    target: { dailyBudget: t.targets.targetDailyBudget, dailyOrders: target },
    scalePct: pct,
    cooldownDays: t.cooldownDays,
    cycles,
    estimatedWeeks,
    estimatedCreativesNeeded: creatives,
    reachesTarget,
    projectedFinalOrders: finalOrders,
    notes,
    creativePlan,
    assumptions: {
      ordersPerDollar: clientBrief.currentDailyBudget > 0 ? clientBrief.currentDailyConversions / clientBrief.currentDailyBudget : 0,
      efficiencyDecayPerCycle: opts.efficiencyDecayPerCycle ?? 0,
      cyclePlanningPct: pct,
    },
  };
}
