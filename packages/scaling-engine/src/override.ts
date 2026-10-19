import { addDays, fmtCount, fmtMoney, fmtRoas, round2, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { deriveThresholds } from "./targets";
import type { ScaleDecision, ScalingMetrics, SystemVerdict } from "./types";

/**
 * The one inline opinion shown when a client picks a different % than the system.
 * Confident-peer tone, framed in the client's numbers. Never blocks; returns null on agreement.
 * @param daysOfData days since the last budget change (or the lookback length on the first cycle)
 */
export function buildOverrideOpinion(
  verdict: SystemVerdict,
  clientPct: number,
  metrics: ScalingMetrics,
  clientBrief: ScalingBrief,
  daysOfData: number,
): string | null {
  const sys = verdict.pct;
  if (clientPct === sys) return null;
  const proceed = `Proceeding with your choice of ${clientPct}%.`;
  const target = fmtCount(clientBrief.targetDailyConversions);

  if (sys === 0) {
    const why = verdict.tier === "borderline"
      ? `your ROAS is ${fmtRoas(metrics.roas)}, under your ${fmtRoas(deriveThresholds(clientBrief).targets.targetRoas)} target, so added spend is likely to buy less efficiently`
      : "the current signals point to fatigue, and more budget tends to amplify it";
    return `We'd recommend holding this cycle — ${why}. ${proceed}`;
  }
  if (clientPct > sys) {
    return `We'd recommend ${sys}% here. A ${clientPct}% jump after ${daysOfData} days of data may shock the algorithm before it stabilizes. ${proceed}`;
  }
  return `We'd recommend ${sys}% — your metrics support a stronger move. ${clientPct}% is safe but may slow your path to ${target} orders/day. ${proceed}`;
}

export interface EarlyScaleCard {
  dayOfCooldown: number;
  cooldownLength: number;
  daysRemaining: number;
  verdict: string;
  reason: string;
  metrics: { roas: number; cpa: number | null; trend: "stabilizing" | "improving" | "dipping"; ordersToday: number; targetOrders: number };
}

/**
 * Card shown when the client hits "Scale now" during a cooldown.
 * @throws if the decision is not in cooldown
 */
export function evaluateEarlyScaleRequest(
  decision: ScaleDecision,
  metrics: ScalingMetrics,
  clientBrief: ScalingBrief,
  now: Date,
  platformName = "Meta",
): EarlyScaleCard {
  const cd = decision.cooldown;
  if (!cd?.active) throw new Error("No active cooldown");
  const hours = Math.max(1, Math.round((now.getTime() - cd.startedAt.getTime()) / 3_600_000));
  const d = metrics.roasDeltaDoD;
  const trend = d == null || Math.abs(d) < 0.05 ? "stabilizing" : d > 0 ? "improving" : "dipping";
  const since = hours <= 72 ? `${hours} hours` : `${Math.floor(hours / 24)} days`;
  return {
    dayOfCooldown: cd.dayOfCooldown,
    cooldownLength: cd.lengthDays,
    daysRemaining: cd.daysRemaining,
    verdict: `Wait until Day ${cd.lengthDays} (${cd.daysRemaining} more ${cd.daysRemaining === 1 ? "day" : "days"})`,
    reason: `It has been ${since} since the last increase. ${platformName}'s algorithm typically needs 3-5 days to stabilize after a budget change. Scaling now means reading noisy data — you may increase budget into a temporary dip.`,
    metrics: {
      roas: metrics.latest.roas,
      cpa: metrics.latest.cpa,
      trend,
      ordersToday: Math.round(metrics.latest.dailyConversions),
      targetOrders: clientBrief.targetDailyConversions,
    },
  };
}

export interface ExecutionRequest {
  clientPct: number;
  now: Date;
  /** Client chose "Scale now anyway" during a cooldown. */
  earlyOverride?: boolean;
  /** Client chose to continue past a detected ceiling. */
  ceilingOverride?: boolean;
  thresholds?: Thresholds;
}

export interface ExecutionPlan {
  cycleNumber: number;
  budgetBefore: number;
  budgetAfter: number;
  /** Actual change applied, in percent, after the cap. */
  pctChange: number;
  systemRecommendationPct: number;
  clientChosenPct: number;
  overrideFlag: boolean;
  earlyTriggerFlag: boolean;
  dayOfCooldownWhenTriggered: number | null;
  cooldownLength: number | null;
  cooldownDays: number;
  startedAt: Date;
  cooldownEndsAt: Date;
  cappedAtMax: boolean;
}

export class ScalingNotAllowedError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/**
 * Turns the client's choice into the exact change to execute and log.
 * The client has final say on the %: overrides are allowed, as is scaling early or past a
 * ceiling when explicitly requested. The client's own hard constraints still hold: the
 * max budget cap is never exceeded, and hard stops / blocking gates / blackout dates are respected.
 * @throws ScalingNotAllowedError when the decision state does not permit a budget change
 */
export function planExecution(decision: ScaleDecision, clientBrief: ScalingBrief, req: ExecutionRequest): ExecutionPlan {
  const t = req.thresholds ?? deriveThresholds(clientBrief);
  if (!Number.isFinite(req.clientPct) || req.clientPct <= 0 || req.clientPct > 100) {
    throw new ScalingNotAllowedError("Choose an increase between 1% and 100%.", "invalid_pct");
  }
  switch (decision.status) {
    case "blocked":
    case "hard_stop":
    case "goal_reached":
      throw new ScalingNotAllowedError(decision.message, decision.status);
    case "cooldown":
      if (!req.earlyOverride) throw new ScalingNotAllowedError(decision.message, "cooldown");
      break;
    case "ceiling":
      if (!req.ceilingOverride) throw new ScalingNotAllowedError(decision.message, "ceiling");
      break;
  }
  // The cooldown short-circuits the other checks in evaluateScaleDecision, so re-apply them here.
  if (decision.status === "cooldown") {
    if (decision.block.blocked) throw new ScalingNotAllowedError(decision.block.reasons[0]!.message, "blocked");
    if (decision.verdict.tier === "hard_stop") throw new ScalingNotAllowedError(decision.verdict.reason, "hard_stop");
  }

  const before = decision.card.budgetBefore;
  if (before >= t.maxBudgetCap) {
    throw new ScalingNotAllowedError(`You're already at your max daily budget of ${fmtMoney(t.maxBudgetCap)}.`, "at_cap");
  }
  const raw = before * (1 + req.clientPct / 100);
  const after = round2(Math.min(raw, t.maxBudgetCap));
  const early = decision.status === "cooldown";
  return {
    cycleNumber: decision.card.cycleNumber,
    budgetBefore: before,
    budgetAfter: after,
    pctChange: round2(((after - before) / before) * 100),
    systemRecommendationPct: decision.verdict.pct,
    clientChosenPct: req.clientPct,
    overrideFlag: req.clientPct !== decision.verdict.pct,
    earlyTriggerFlag: early,
    dayOfCooldownWhenTriggered: early ? decision.cooldown!.dayOfCooldown : null,
    cooldownLength: early ? decision.cooldown!.lengthDays : null,
    cooldownDays: t.cooldownDays,
    startedAt: req.now,
    cooldownEndsAt: addDays(req.now, t.cooldownDays),
    cappedAtMax: raw > t.maxBudgetCap,
  };
}
