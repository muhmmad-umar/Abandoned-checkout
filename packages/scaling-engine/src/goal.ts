import { fmtCount, fmtMoney, fmtRoas, plural, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { appliedCycles } from "./ceiling";
import { deriveThresholds } from "./targets";
import type { CycleRecord, ScaleDecision } from "./types";
import type { RoadmapCycle } from "./roadmap";

export type GoalStatus = "on_track" | "slightly_behind" | "off_track" | "ceiling" | "goal_reached";

export const GOAL_STATUS_TEXT: Record<GoalStatus, string> = {
  on_track: "🟢 On track — scaling as planned",
  slightly_behind: "🟡 Slightly behind — consider creative refresh to maintain pace",
  off_track: "🔴 Off track — scaling paused, action required",
  ceiling: "⚠️ Ceiling detected — creatives needed before next scale",
  goal_reached: "🏁 Goal reached — set new target or enter maintenance mode",
};

export interface GoalProgress {
  targetOrders: number;
  ordersToday: number;
  ordersPct: number;
  dailySpend: number;
  spendPctOfTarget: number;
  roas: { value: number; target: number; ok: boolean; text: string };
  cpa: { value: number | null; ceiling: number; ok: boolean; text: string };
  cyclesCompleted: number;
  cyclesTotalEstimate: number | null;
  estCyclesRemaining: number | null;
  estWeeksRemaining: number | null;
  nextWindowInDays: number;
  status: GoalStatus;
  statusText: string;
}

/**
 * Builds the goal-progress header shown at the top of every campaign view.
 * "Slightly behind" means today's orders trail the roadmap's projection for the cycles done by more than 10%.
 */
export function buildGoalProgress(
  brief: ScalingBrief,
  today: { conversions: number; spend: number; roas: number; cpa: number | null },
  decision: ScaleDecision,
  cycles: CycleRecord[],
  roadmap: RoadmapCycle[],
  thresholds?: Thresholds,
): GoalProgress {
  const t = thresholds ?? deriveThresholds(brief);
  const target = t.targets.targetDailyConversions;
  const done = appliedCycles(cycles).length;
  const remaining = decision.verdict.cyclesToGoal;
  const projectedNow = done > 0 ? roadmap[Math.min(done, roadmap.length) - 1]?.estimatedOrders : undefined;

  let status: GoalStatus;
  if (today.conversions >= target || decision.status === "goal_reached") status = "goal_reached";
  else if (decision.status === "ceiling") status = "ceiling";
  else if (decision.status === "blocked" || decision.status === "hard_stop") status = "off_track";
  else if ((projectedNow != null && today.conversions < projectedNow * 0.9) || decision.verdict.tier === "borderline" || decision.verdict.tier === "declining") status = "slightly_behind";
  else status = "on_track";

  const roasOk = today.roas >= t.targets.targetRoas;
  const cpaOk = today.cpa == null || today.cpa <= brief.maxAcceptableCpa;
  return {
    targetOrders: target,
    ordersToday: today.conversions,
    ordersPct: Math.min(1, today.conversions / target),
    dailySpend: today.spend,
    spendPctOfTarget: Math.min(1, today.spend / t.targets.targetDailyBudget),
    roas: {
      value: today.roas,
      target: t.targets.targetRoas,
      ok: roasOk,
      text: `${fmtRoas(today.roas)} ${roasOk ? "✅ above" : "⚠️ below"} your target (${fmtRoas(t.targets.targetRoas)})`,
    },
    cpa: {
      value: today.cpa,
      ceiling: brief.maxAcceptableCpa,
      ok: cpaOk,
      text: today.cpa == null ? "No conversions yet today" : `${fmtMoney(today.cpa)} ${cpaOk ? "✅ below" : "⚠️ above"} your ceiling (${fmtMoney(brief.maxAcceptableCpa)})`,
    },
    cyclesCompleted: done,
    cyclesTotalEstimate: remaining == null ? (roadmap.length || null) : done + remaining,
    estCyclesRemaining: remaining,
    estWeeksRemaining: remaining == null ? null : Math.ceil((remaining * t.cooldownDays) / 7),
    nextWindowInDays: decision.cooldown?.daysRemaining ?? 0,
    status,
    statusText: GOAL_STATUS_TEXT[status],
  };
}

/** One-line summary, e.g. "Today: 67 of 100 orders · 4 of ~7 cycles · next window in 2 days". */
export function goalProgressSummary(p: GoalProgress): string {
  const parts = [`Today: ${fmtCount(p.ordersToday)} of ${fmtCount(p.targetOrders)} orders`];
  if (p.cyclesTotalEstimate) parts.push(`${p.cyclesCompleted} of ~${p.cyclesTotalEstimate} cycles`);
  parts.push(p.nextWindowInDays > 0 ? `next window in ${plural(p.nextWindowInDays, "day")}` : "scaling window open");
  return parts.join(" · ");
}
