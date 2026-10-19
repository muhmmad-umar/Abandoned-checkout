import {
  buildBrief, calculateCreativeHealthScore, calculateCreativesNeeded, DEFAULT_ANGLES, detectFatigue,
  findUntestedAngles, identifyWinningPatterns, recommendedMinimumCreatives, scoreCreatives,
} from "@ad-scaler/creative-engine";
import { toCreativeInputs } from "@ad-scaler/db";
import { templates } from "@ad-scaler/notifications";
import { DAY_MS } from "@ad-scaler/shared";
import { loadCampaignContext, json } from "../context";
import { campaignLink, notifyUser, type AnalysisTriggerName, type Deps } from "../deps";

export interface CreativeAnalysisResult {
  analysisRunId: string;
  creativeBriefId: string;
  creativeHealthScore: number;
  creativesNeeded: number;
  notified: boolean;
}

/**
 * Phase 1: scores every creative, finds fatigue and winning patterns, writes the creative brief
 * and its items, and notifies the client when new creatives are needed.
 * On schedule, notification follows the client's refresh cadence; fatigue, ceiling and manual
 * triggers always notify.
 */
export async function runCreativeAnalysis(deps: Deps, campaignId: string, trigger: AnalysisTriggerName): Promise<CreativeAnalysisResult> {
  const { db } = deps;
  const ctx = await loadCampaignContext(deps, campaignId);
  const { thresholds: t, campaign } = ctx;
  const now = deps.now();
  const run = await db.analysisRun.create({ data: { campaignId, trigger, startedAt: now } });

  try {
    const ads = await db.ad.findMany({ where: { campaignId, retiredAt: null } });
    const user = await db.user.findUniqueOrThrow({ where: { id: campaign.userId } });
    const inputs = toCreativeInputs(ads, ctx.snapshots);
    const ranked = scoreCreatives(inputs);
    const fatigued = detectFatigue(inputs, {
      healthyRoas: t.targets.targetRoas,
      targetCpa: t.targets.targetCpa,
      noConversionSpend: t.targets.targetCpa * 2,
      frequencyThreshold: t.fatigue.frequency,
      ctrDeclinePct: t.fatigue.ctrDeclinePct,
      roasDegradePct: t.fatigue.roasDegradePct,
    });
    const patterns = identifyWinningPatterns(ranked);
    const taxonomy = user.angleTaxonomy.length ? user.angleTaxonomy : DEFAULT_ANGLES;
    const untested = findUntestedAngles(taxonomy, ranked, 2);
    const allUntested = findUntestedAngles(taxonomy, ranked, taxonomy.length);
    const active = ranked.filter((c) => c.metrics.spend > 0);
    const fatiguedIds = new Set(fatigued.map((f) => f.adId));
    const healthy = active.filter((c) => !fatiguedIds.has(c.adId)).length;
    const budget = ctx.currentDailyBudget ?? ctx.brief.currentDailyBudget;
    const needed = calculateCreativesNeeded(healthy, fatigued.length, untested.length, recommendedMinimumCreatives(budget, t.targets.targetCpa));
    const brief = buildBrief(patterns, fatigued, needed, ctx.brief, { untestedAngles: untested });
    const lastRefresh = ads.reduce<Date | null>((max, a) => (a.launchedAt && (!max || a.launchedAt > max) ? a.launchedAt : max), null);
    const healthScore = calculateCreativeHealthScore(ranked, fatigued, lastRefresh, {
      now,
      refreshFrequency: ctx.brief.creativeRefreshFrequency,
      untestedAngleCount: allUntested.length,
    });

    const previous = await db.creativeBrief.findFirst({ where: { campaignId, notificationSentAt: { not: null } }, orderBy: { generatedAt: "desc" } });
    const cadenceOk = !previous?.notificationSentAt || now.getTime() - previous.notificationSentAt.getTime() >= t.creativeBriefCadenceDays * DAY_MS;
    const shouldNotify = needed > 0 && (trigger !== "schedule" || cadenceOk);

    const snapshotDate = new Date(now.toISOString().slice(0, 10));
    const saved = await db.$transaction(async (tx) => {
      await tx.creativeScore.createMany({
        data: ranked.map((c) => {
          const f = fatigued.find((x) => x.adId === c.adId);
          return {
            campaignId, adId: c.adId, analysisRunId: run.id, score: c.score,
            hookRate: c.metrics.hookRate, ctr: c.metrics.ctr, roas: c.metrics.roas, cpa: c.metrics.cpa,
            frequency: c.metrics.frequency, completionRate: c.metrics.completionRate, trend: c.trend,
            fatigueFlag: !!f, fatigueReason: f?.reasons.map((r) => r.message).join(" ") ?? null, snapshotDate,
          };
        }),
      });
      const cb = await tx.creativeBrief.create({
        data: {
          campaignId, analysisRunId: run.id, creativeHealthScore: healthScore, creativesNeeded: needed,
          headline: brief.headline,
          winningPatterns: json({ top: patterns.top, losing: patterns.losing, headline: brief.topPatterns, summary: brief.summary }),
          creativesToRetire: json(brief.toRetire),
          generatedAt: now,
          notificationSentAt: shouldNotify ? now : null,
          items: {
            create: brief.items.map((i) => ({
              priority: i.priority, suggestedFormat: i.suggestedFormat, suggestedAngle: i.suggestedAngle,
              rationale: i.rationale, whatToAvoid: i.whatToAvoid,
              details: json({ kind: i.kind, suggestedLength: i.suggestedLength, suggestedVisualStyle: i.suggestedVisualStyle, suggestedTone: i.suggestedTone, replacesAdId: i.replacesAdId }),
            })),
          },
        },
      });
      await tx.analysisRun.update({ where: { id: run.id }, data: { finishedAt: deps.now() } });
      return cb;
    });

    if (shouldNotify) {
      await notifyUser(deps, campaign.userId, templates.creativeBriefReady(campaign, needed, campaignLink(deps, campaignId, "creative-brief")));
    }
    // A campaign blocked on creative health can resume as soon as the score recovers.
    if (campaign.scalingState === "blocked" && healthScore >= t.creativeHealthBlockThreshold) {
      await deps.enqueue.evaluateScaling(campaignId);
    }
    return { analysisRunId: run.id, creativeBriefId: saved.id, creativeHealthScore: healthScore, creativesNeeded: needed, notified: shouldNotify };
  } catch (e) {
    await db.analysisRun.update({ where: { id: run.id }, data: { finishedAt: deps.now(), error: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}

/** Latest creative health and fatigued share, or null before the first analysis. */
export async function latestCreativeHealth(deps: Deps, campaignId: string) {
  const brief = await deps.db.creativeBrief.findFirst({ where: { campaignId }, orderBy: { generatedAt: "desc" } });
  if (!brief) return null;
  const scores = await deps.db.creativeScore.findMany({ where: { analysisRunId: brief.analysisRunId } });
  const active = scores.filter((s) => s.score != null);
  return {
    score: brief.creativeHealthScore,
    fatiguedShare: active.length ? active.filter((s) => s.fatigueFlag).length / active.length : 0,
    generatedAt: brief.generatedAt,
  };
}

