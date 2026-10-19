import { cooldownViolation, toCycleRecord, type ScalingState } from "@ad-scaler/db";
import { templates } from "@ad-scaler/notifications";
import {
  aggregateWindow, buildScalingProfile, calculateScalingHealthScore, detectCeiling, evaluateOutcome,
  evaluateScaleDecision, planExecution, ScalingNotAllowedError, toMetricPoint,
  type DecisionStatus, type ScaleDecision, type ScalingMetrics,
} from "@ad-scaler/scaling-engine";
import { isoDate } from "@ad-scaler/shared";
import { loadCampaignContext, json, type CampaignContext } from "../context";
import { campaignLink, notifyUser, type Deps } from "../deps";
import { latestCreativeHealth } from "./creative";

const STATE_FOR: Record<DecisionStatus, ScalingState> = {
  recommend: "awaiting_client",
  cooldown: "cooldown",
  blocked: "blocked",
  hard_stop: "blocked",
  ceiling: "ceiling",
  goal_reached: "goal_reached",
};

/** Executions stuck in 'executing' longer than this are reconciled against the live budget. */
const STUCK_AFTER_MS = 10 * 60_000;

/** Builds the current decision from fresh data. Returns null when there is no data or no creative analysis yet. */
export async function currentDecision(deps: Deps, ctx: CampaignContext): Promise<{ decision: ScaleDecision; metrics: ScalingMetrics } | null> {
  if (ctx.daily.length === 0) return null;
  const health = await latestCreativeHealth(deps, ctx.campaign.id);
  if (!health) return null;
  const metrics = aggregateWindow(ctx.daily, ctx.thresholds.lookbackDays);
  const decision = evaluateScaleDecision(metrics, ctx.brief, ctx.cycles, {
    now: deps.now(),
    creativeHealthScore: health.score,
    fatiguedShare: health.fatiguedShare,
    currentDailyBudget: ctx.currentDailyBudget,
    campaignAgeDays: ctx.campaignAgeDays,
    thresholds: ctx.thresholds,
  });
  return { decision, metrics };
}

/**
 * Closes the loop on cycles whose cooldown has ended: measures the post-cycle window, compares
 * it with the prediction, writes the outcome note, refreshes the client's scaling profile and
 * notifies the client.
 */
export async function evaluateCycleOutcomes(deps: Deps, ctx: CampaignContext): Promise<number> {
  const now = deps.now();
  const due = ctx.cycleRows.filter((c) => c.status === "active" && c.cooldownEndsAt <= now && !c.postCycleMetrics);
  for (const row of due) {
    const start = isoDate(row.startedAt);
    const end = isoDate(row.cooldownEndsAt);
    const window = ctx.daily.filter((d) => d.date > start && d.date <= end);
    if (window.length === 0) continue;
    const post = toMetricPoint(window);
    const result = evaluateOutcome(toCycleRecord(row), post);
    const ceiling = detectCeiling(ctx.cycles.filter((c) => c.cycleNumber <= row.cycleNumber), aggregateWindow(window, window.length), ctx.brief, ctx.thresholds);
    await deps.db.scalingCycle.update({
      where: { id: row.id },
      data: {
        status: "completed",
        postCycleRoas: post.roas,
        postCycleCpa: post.cpa,
        postCycleConversions: post.dailyConversions,
        postCycleMetrics: json(post),
        outcomeVsPrediction: result.outcome,
        systemNote: result.note,
        ceilingDetected: ceiling.detected,
        ceilingReason: ceiling.reasons.map((r) => r.message).join(" ") || null,
      },
    });
    await notifyUser(deps, ctx.campaign.userId, templates.cycleOutcome(ctx.campaign, result.note, campaignLink(deps, ctx.campaign.id)));
  }
  if (due.length) await refreshScalingProfile(deps, ctx.campaign.id, ctx.campaign.userId);
  return due.length;
}

export async function refreshScalingProfile(deps: Deps, campaignId: string, userId: string) {
  const rows = await deps.db.scalingCycle.findMany({ where: { campaignId } });
  const p = buildScalingProfile(rows.map(toCycleRecord));
  const existing = await deps.db.clientScalingProfile.findUnique({ where: { campaignId } });
  const stats = {
    totalCycles: p.totalCycles,
    totalOverrides: p.totalOverrides,
    overrideOutperformedCount: p.overrideOutperformedCount,
    avgClientVsSystemDelta: p.avgClientVsSystemDelta,
    // A risk appetite the client set by hand is kept.
    ...(existing?.manuallyAdjusted ? {} : { riskAppetite: p.riskAppetite }),
  };
  await deps.db.clientScalingProfile.upsert({ where: { campaignId }, update: stats, create: { campaignId, userId, ...stats } });
  return p;
}

/**
 * Resolves budget changes left in 'executing' (e.g. the worker died mid-call) by reading the
 * live budget: if it matches the planned value the change landed, otherwise it did not.
 */
export async function reconcileStuckExecutions(deps: Deps, campaignId: string): Promise<number> {
  const now = deps.now();
  const stuck = await deps.db.scalingCycle.findMany({
    where: { campaignId, status: "executing", startedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    include: { logs: true, campaign: { include: { adAccount: true } } },
  });
  for (const c of stuck) {
    let landed = false;
    try {
      const live = await deps.platformFor(c.campaign.adAccount).getBudgetTarget(c.campaign.platformCampaignId);
      landed = Math.abs(live.dailyBudget - Number(c.budgetAfter)) < 0.01;
    } catch {
      continue; // try again next run
    }
    await deps.db.$transaction(async (tx) => {
      for (const l of c.logs.filter((l) => l.apiCallStatus === "pending")) {
        await tx.scalingLog.update({
          where: { id: l.id },
          data: landed ? { apiCallStatus: "success" } : { apiCallStatus: "failed", errorMessage: "Execution interrupted; budget change did not land" },
        });
      }
      await tx.scalingCycle.update({ where: { id: c.id }, data: { status: landed ? "active" : "failed" } });
      if (landed) await tx.campaign.update({ where: { id: campaignId }, data: { currentDailyBudget: c.budgetAfter, scalingState: "cooldown" } });
    });
  }
  return stuck.length;
}

export interface EvaluateResult {
  status: DecisionStatus | "awaiting_data" | "awaiting_creative_analysis" | "inactive";
  recommendationId?: string;
  scalingHealthScore?: number;
}

/**
 * Phase 2 evaluation. Produces a recommendation card for the client; never changes a budget.
 * Notifies only when the campaign's scaling state changes, so scheduled runs don't spam.
 */
export async function evaluateScaling(deps: Deps, campaignId: string): Promise<EvaluateResult> {
  const { db } = deps;
  await reconcileStuckExecutions(deps, campaignId);
  let ctx = await loadCampaignContext(deps, campaignId);
  if (ctx.campaign.status !== "active") return { status: "inactive" };
  if (await evaluateCycleOutcomes(deps, ctx)) ctx = await loadCampaignContext(deps, campaignId);

  if (ctx.daily.length === 0) return { status: "awaiting_data" };
  const current = await currentDecision(deps, ctx);
  if (!current) {
    await deps.enqueue.creativeAnalysis(campaignId, "schedule");
    return { status: "awaiting_creative_analysis" };
  }
  const { decision, metrics } = current;
  const healthScore = calculateScalingHealthScore(ctx.cycles, metrics);
  const newState = STATE_FOR[decision.status];
  const prevState = ctx.campaign.scalingState;

  const rec = await db.$transaction(async (tx) => {
    await tx.scalingRecommendation.updateMany({ where: { campaignId, status: "open" }, data: { status: "superseded", resolvedAt: deps.now() } });
    const r = await tx.scalingRecommendation.create({
      data: { campaignId, decision: json(decision), metrics: json(metrics), healthScore, createdAt: deps.now() },
    });
    await tx.campaign.update({ where: { id: campaignId }, data: { scalingState: newState } });
    return r;
  });

  if (newState !== prevState) {
    const link = campaignLink(deps, campaignId);
    const c = ctx.campaign;
    if (decision.status === "recommend") await notifyUser(deps, c.userId, templates.recommendationReady(c, decision.verdict.reason, link));
    if (decision.status === "blocked" || decision.status === "hard_stop") await notifyUser(deps, c.userId, templates.scalingBlocked(c, decision.message, link));
    if (decision.status === "goal_reached") await notifyUser(deps, c.userId, templates.goalReached(c, decision.card.targetOrders, link));
    if (decision.status === "ceiling") {
      await notifyUser(deps, c.userId, templates.ceilingDetected(c, decision.ceiling.reasons.map((r) => r.message), campaignLink(deps, campaignId, "creative-brief")));
      await deps.enqueue.creativeAnalysis(campaignId, "ceiling");
    }
  }
  return { status: decision.status, recommendationId: rec.id, scalingHealthScore: healthScore };
}

export interface ExecuteRequest {
  recommendationId: string;
  userId: string;
  clientPct: number;
  earlyOverride?: boolean;
  ceilingOverride?: boolean;
}

export type ExecuteResult =
  | { ok: true; cycleId: string; cycleNumber: number; budgetBefore: number; budgetAfter: number; cooldownEndsAt: Date }
  | { ok: false; code: string; message: string };

/**
 * Applies the client's choice. Order of operations:
 *  1. Re-evaluate on fresh data and the live platform budget; refuse if no longer allowed.
 *  2. In one transaction, insert the cycle as 'executing' (the DB trigger enforces cooldown)
 *     and append the scaling log entry. The change is logged before anything is sent.
 *  3. Call the platform.
 *  4. On failure: mark the log 'failed' and the cycle 'failed'. The cycle state does not advance.
 *     On success: mark the log 'success', the cycle 'active', and start the cooldown.
 */
export async function executeScaling(deps: Deps, req: ExecuteRequest): Promise<ExecuteResult> {
  const { db } = deps;
  const rec = await db.scalingRecommendation.findUnique({ where: { id: req.recommendationId }, include: { campaign: { include: { adAccount: true } } } });
  if (!rec || rec.campaign.userId !== req.userId) return { ok: false, code: "not_found", message: "Recommendation not found" };
  if (rec.status !== "open") return { ok: false, code: "stale", message: "This recommendation is no longer current. Refresh to see the latest one." };
  const campaignId = rec.campaignId;
  const platform = deps.platformFor(rec.campaign.adAccount);

  await reconcileStuckExecutions(deps, campaignId);
  const ctx = await loadCampaignContext(deps, campaignId);
  let target;
  try {
    target = await platform.getBudgetTarget(ctx.campaign.platformCampaignId);
  } catch (e) {
    return { ok: false, code: "platform_error", message: e instanceof Error ? e.message : String(e) };
  }
  ctx.currentDailyBudget = target.dailyBudget;
  const fresh = await currentDecision(deps, ctx);
  if (!fresh) return { ok: false, code: "awaiting_data", message: "Not enough data to scale yet." };

  let plan;
  try {
    plan = planExecution(fresh.decision, ctx.brief, {
      clientPct: req.clientPct,
      now: deps.now(),
      earlyOverride: req.earlyOverride,
      ceilingOverride: req.ceilingOverride,
      thresholds: ctx.thresholds,
    });
  } catch (e) {
    if (e instanceof ScalingNotAllowedError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
  // Log what the client was shown, which is what they chose against.
  const shown = rec.decision as unknown as ScaleDecision;
  const systemPct = shown.verdict.pct;
  const overrideFlag = req.clientPct !== systemPct;
  const triggeredBy = plan.earlyTriggerFlag ? "early_override" : overrideFlag ? "client_override" : "system";

  let cycleId: string;
  let logId: string;
  try {
    ({ cycleId, logId } = await db.$transaction(async (tx) => {
      const cycle = await tx.scalingCycle.create({
        data: {
          campaignId, recommendationId: rec.id, cycleNumber: plan.cycleNumber, status: "executing",
          startedAt: plan.startedAt, cooldownEndsAt: plan.cooldownEndsAt,
          budgetBefore: plan.budgetBefore, budgetAfter: plan.budgetAfter, pctChange: plan.pctChange,
          systemRecommendationPct: systemPct, clientChosenPct: plan.clientChosenPct, overrideFlag,
          earlyTriggerFlag: plan.earlyTriggerFlag, dayOfCooldownWhenTriggered: plan.dayOfCooldownWhenTriggered,
          cooldownLength: plan.cooldownLength, ceilingOverrideFlag: !!req.ceilingOverride && fresh.decision.status === "ceiling",
          triggerMetrics: json(toMetricPointFrom(fresh.metrics)), systemRationale: shown.verdict.reason,
        },
      });
      const log = await tx.scalingLog.create({
        data: {
          campaignId, cycleId: cycle.id, actionType: "budget_change", triggeredBy,
          oldValue: json({ dailyBudget: plan.budgetBefore, entity: target }),
          newValue: json({
            dailyBudget: plan.budgetAfter, pctChange: plan.pctChange, cycleNumber: plan.cycleNumber,
            systemRecommendationPct: systemPct, clientChosenPct: plan.clientChosenPct, overrideFlag,
            earlyOverride: plan.earlyTriggerFlag, dayOfCooldown: plan.dayOfCooldownWhenTriggered, cooldownLength: plan.cooldownLength,
            cappedAtMax: plan.cappedAtMax, triggerMetrics: toMetricPointFrom(fresh.metrics),
          }),
          timestamp: deps.now(),
        },
      });
      return { cycleId: cycle.id, logId: log.id };
    }));
  } catch (e) {
    const v = cooldownViolation(e);
    if (v === "cooldown_active") return { ok: false, code: "cooldown", message: fresh.decision.cooldown?.message ?? "Campaign is in cooldown." };
    if (v === "execution_in_progress") return { ok: false, code: "in_progress", message: "Another budget change is already being applied." };
    throw e;
  }

  try {
    await platform.setDailyBudget(target.id, plan.budgetAfter);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.$transaction([
      db.scalingLog.update({ where: { id: logId }, data: { apiCallStatus: "failed", errorMessage: message } }),
      db.scalingCycle.update({ where: { id: cycleId }, data: { status: "failed" } }),
    ]);
    await notifyUser(deps, req.userId, templates.executionFailed(ctx.campaign, message, campaignLink(deps, campaignId)));
    return { ok: false, code: "platform_error", message };
  }

  await db.$transaction([
    db.scalingLog.update({ where: { id: logId }, data: { apiCallStatus: "success" } }),
    db.scalingCycle.update({ where: { id: cycleId }, data: { status: "active" } }),
    db.campaign.update({ where: { id: campaignId }, data: { currentDailyBudget: plan.budgetAfter, scalingState: "cooldown" } }),
    db.scalingRecommendation.update({ where: { id: rec.id }, data: { status: "applied", resolvedAt: deps.now() } }),
  ]);
  await refreshScalingProfile(deps, campaignId, req.userId);
  return { ok: true, cycleId, cycleNumber: plan.cycleNumber, budgetBefore: plan.budgetBefore, budgetAfter: plan.budgetAfter, cooldownEndsAt: plan.cooldownEndsAt };
}

function toMetricPointFrom(m: ScalingMetrics) {
  const { roas, cpa, ctr, cpm, frequency, dailyConversions, dailySpend, efficiency } = m;
  return { roas, cpa, ctr, cpm, frequency, dailyConversions, dailySpend, efficiency };
}
