import { DAY_MS, fmtMoney, plural, round2, type ScalingBrief } from "@ad-scaler/shared";
import { shouldBlockScaling } from "./block";
import { appliedCycles, detectCeiling } from "./ceiling";
import { deriveThresholds } from "./targets";
import { calculateSystemVerdict } from "./verdict";
import type { CooldownState, CycleRecord, DecisionContext, RecommendationCard, ScaleDecision, ScalingMetrics } from "./types";

/**
 * Cooldown state after the most recent applied cycle, or null when no cycle has run.
 * `cooldownEndsAt` on the cycle is authoritative (it is what the database enforces).
 */
export function cooldownState(cycleHistory: CycleRecord[], now: Date): CooldownState | null {
  const cycles = appliedCycles(cycleHistory);
  const last = cycles[cycles.length - 1];
  if (!last) return null;
  const lengthDays = Math.round((last.cooldownEndsAt.getTime() - last.startedAt.getTime()) / DAY_MS);
  const remainingMs = last.cooldownEndsAt.getTime() - now.getTime();
  const active = remainingMs > 0;
  const daysRemaining = active ? Math.ceil(remainingMs / DAY_MS) : 0;
  const dayOfCooldown = Math.max(1, Math.floor((now.getTime() - last.startedAt.getTime()) / DAY_MS));
  return {
    active,
    cycleNumber: last.cycleNumber,
    startedAt: last.startedAt,
    endsAt: last.cooldownEndsAt,
    lengthDays,
    dayOfCooldown: Math.min(dayOfCooldown, lengthDays),
    daysRemaining,
    message: active ? `Next scaling window opens in ${plural(daysRemaining, "day")}` : "Scaling window is open",
  };
}

/** Budget currently live: the platform value if known, else the last applied cycle, else the brief. */
export function currentBudget(brief: ScalingBrief, cycles: CycleRecord[], live?: number): number {
  if (live != null) return live;
  const applied = appliedCycles(cycles);
  return applied[applied.length - 1]?.budgetAfter ?? brief.currentDailyBudget;
}

/**
 * Runs the full Phase 2 evaluation for a campaign and returns what to present to the client.
 * Precedence: goal reached → cooldown → blocking gates → ceiling → hard stop → recommendation.
 * The verdict is always computed so every card (including early-scale) can show it.
 * This never executes anything; a recommendation always waits for the client.
 */
export function evaluateScaleDecision(
  metrics: ScalingMetrics,
  clientBrief: ScalingBrief,
  cycles: CycleRecord[],
  ctx: DecisionContext,
): ScaleDecision {
  const t = ctx.thresholds ?? deriveThresholds(clientBrief);
  const verdict = calculateSystemVerdict(metrics, clientBrief, { thresholds: t, fatiguedShare: ctx.fatiguedShare });
  const cooldown = cooldownState(cycles, ctx.now);
  const ageDays = ctx.campaignAgeDays ?? clientBrief.campaignAgeDays;
  const last7Spend = metrics.dailySpend * 7;
  const last7Conversions = metrics.dailyConversions * 7;
  const block = shouldBlockScaling(ctx.creativeHealthScore, ageDays, last7Spend, clientBrief, {
    now: ctx.now,
    conversionsLast7d: last7Conversions,
    fatiguedShare: ctx.fatiguedShare,
    thresholds: t,
    timeZone: ctx.timeZone,
  });
  const ceiling = detectCeiling(cycles, metrics, clientBrief, t);

  const before = currentBudget(clientBrief, cycles, ctx.currentDailyBudget);
  const pct = verdict.pct;
  const after = round2(Math.min(before * (1 + pct / 100), t.maxBudgetCap));
  const completed = appliedCycles(cycles).length;
  const card: RecommendationCard = {
    cycleNumber: completed + 1,
    budgetBefore: before,
    budgetIfApplied: after,
    estOrdersAfter: Math.round(metrics.dailyConversions * (before > 0 ? after / before : 1)),
    targetOrders: t.targets.targetDailyConversions,
    totalCyclesEstimate: verdict.cyclesToGoal == null ? null : completed + verdict.cyclesToGoal,
    options: [...new Set([10, 20, 30, pct].filter((p) => p > 0))].sort((a, b) => a - b),
    defaultPct: pct,
  };

  const base = { verdict, block, ceiling, cooldown, card };
  if (metrics.dailyConversions >= t.targets.targetDailyConversions) {
    return { ...base, status: "goal_reached", message: `You've hit ${t.targets.targetDailyConversions} orders/day — your original target. What's next?` };
  }
  if (cooldown?.active) return { ...base, status: "cooldown", message: cooldown.message };
  if (block.blocked) return { ...base, status: "blocked", message: block.reasons[0]!.message };
  if (ceiling.detected) return { ...base, status: "ceiling", message: ceiling.alert! };
  if (verdict.tier === "hard_stop") return { ...base, status: "hard_stop", message: verdict.reason };
  if (before >= t.maxBudgetCap) {
    return { ...base, status: "hard_stop", message: `You're at your max daily budget of ${fmtMoney(t.maxBudgetCap)}. Raise your cap to keep scaling.` };
  }
  return { ...base, status: "recommend", message: verdict.reason };
}
