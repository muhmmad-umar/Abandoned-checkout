import type { ScalingRecommendation } from "@ad-scaler/db";
import { currentDecision, latestCreativeHealth, loadCampaignContext } from "@ad-scaler/queue";
import {
  buildGoalProgress, buildOverrideHistory, calculateScalingHealthScore, cooldownState, evaluateEarlyScaleRequest,
  scalingHealthLabel, SCALING_HEALTH_LABELS, aggregateWindow, type RoadmapCycle, type ScaleDecision, type ScalingMetrics,
} from "@ad-scaler/scaling-engine";
import { deriveThresholds } from "@ad-scaler/scaling-engine";
import type { ScalingBrief, Thresholds } from "@ad-scaler/shared";
import type { ApiServices } from "./services";

type Overrides = Partial<Pick<Thresholds, "cooldownDays" | "lookbackDays" | "creativeHealthBlockThreshold" | "creativeAnalysisIntervalDays" | "scalePctByTier">>;

/** Auto-set thresholds with the client's overrides applied. */
export function thresholdsFor(brief: ScalingBrief, overrides: Overrides = {}): Thresholds {
  return { ...deriveThresholds(brief), ...overrides };
}

/** JSON-stored decisions lose Date types; restore the ones the engine reads. */
export function reviveDecision(raw: unknown): ScaleDecision {
  const d = raw as ScaleDecision;
  if (d.cooldown) d.cooldown = { ...d.cooldown, startedAt: new Date(d.cooldown.startedAt), endsAt: new Date(d.cooldown.endsAt) };
  return d;
}

export function storedRec(rec: ScalingRecommendation) {
  return { decision: reviveDecision(rec.decision), metrics: rec.metrics as unknown as ScalingMetrics };
}

/** Everything the campaign page needs: goal header, the open recommendation card, cooldown, health. */
export async function campaignView(s: ApiServices, campaignId: string) {
  const ctx = await loadCampaignContext(s, campaignId);
  const now = s.now();
  const [rec, roadmap, creative, recs] = await Promise.all([
    s.db.scalingRecommendation.findFirst({ where: { campaignId, status: "open" }, orderBy: { createdAt: "desc" } }),
    s.db.scalingRoadmap.findFirst({ where: { campaignId }, orderBy: { generatedAt: "desc" } }),
    latestCreativeHealth(s, campaignId),
    s.db.scalingRecommendation.findMany({ where: { campaignId }, orderBy: { createdAt: "asc" }, select: { createdAt: true, healthScore: true } }),
  ]);
  const roadmapCycles = (roadmap?.projectedCycles as unknown as RoadmapCycle[] | undefined) ?? [];

  let shown: ReturnType<typeof storedRec> | null = rec ? storedRec(rec) : null;
  // Before the first evaluation, show a live read so the page is never empty.
  if (!shown && ctx.daily.length) shown = await currentDecision(s, ctx);
  if (shown) shown.decision.cooldown = cooldownState(ctx.cycles, now);

  const today = ctx.daily[ctx.daily.length - 1];
  const goal = shown && today
    ? buildGoalProgress(
        ctx.brief,
        { conversions: today.conversions, spend: today.spend, roas: today.spend > 0 ? today.revenue / today.spend : 0, cpa: today.conversions > 0 ? today.spend / today.conversions : null },
        shown.decision, ctx.cycles, roadmapCycles, ctx.thresholds,
      )
    : null;
  const earlyScale = shown?.decision.cooldown?.active ? evaluateEarlyScaleRequest(shown.decision, shown.metrics, ctx.brief, now) : null;
  const scalingHealth = ctx.daily.length ? calculateScalingHealthScore(ctx.cycles, aggregateWindow(ctx.daily, ctx.thresholds.lookbackDays), { minRoas: ctx.thresholds.hardStopMinRoas, maxCpa: ctx.thresholds.hardStopMaxCpa }) : null;

  const lastRow = [...ctx.cycleRows].reverse().find((c) => c.status === "active" || c.status === "completed");
  const lastCycle = lastRow
    ? {
        cycleNumber: lastRow.cycleNumber, startedAt: lastRow.startedAt, budgetBefore: Number(lastRow.budgetBefore), budgetAfter: Number(lastRow.budgetAfter),
        pctChange: Number(lastRow.pctChange), systemRecommendationPct: Number(lastRow.systemRecommendationPct), clientChosenPct: Number(lastRow.clientChosenPct),
        overrideFlag: lastRow.overrideFlag, earlyTriggerFlag: lastRow.earlyTriggerFlag, systemNote: lastRow.systemNote, outcome: lastRow.outcomeVsPrediction,
      }
    : null;

  return {
    lastCycle,
    campaign: {
      id: ctx.campaign.id, name: ctx.campaign.name, status: ctx.campaign.status, scalingState: ctx.campaign.scalingState,
      currentDailyBudget: ctx.currentDailyBudget ?? null, lastSyncedAt: ctx.campaign.lastSyncedAt,
    },
    brief: ctx.brief,
    thresholds: ctx.thresholds,
    goal,
    recommendation: rec && shown ? { id: rec.id, createdAt: rec.createdAt, ...shown.decision } : null,
    earlyScale,
    creativeHealth: creative ? { score: creative.score, fatiguedShare: creative.fatiguedShare, blocksScaling: creative.score < ctx.thresholds.creativeHealthBlockThreshold } : null,
    scalingHealth: scalingHealth == null ? null : { score: scalingHealth, label: SCALING_HEALTH_LABELS[scalingHealthLabel(scalingHealth)] },
    scalingHealthTrend: recs.map((r) => ({ at: r.createdAt, score: r.healthScore })),
    roadmap: roadmap ? { cycles: roadmapCycles, estimatedWeeks: Number(roadmap.estimatedWeeks), estimatedCreativesNeeded: roadmap.estimatedCreativesNeeded, assumptions: roadmap.assumptions } : null,
    overrideHistory: buildOverrideHistory(ctx.cycles),
  };
}
