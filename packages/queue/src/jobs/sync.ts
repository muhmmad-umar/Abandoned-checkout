import { MetaApiError } from "@ad-scaler/meta-client";
import { detectFatigue } from "@ad-scaler/creative-engine";
import { toCreativeInputs, briefThresholds } from "@ad-scaler/db";
import { addDays, isoDate } from "@ad-scaler/shared";
import { templates } from "@ad-scaler/notifications";
import { notifyUser, type Deps } from "../deps";

export interface SyncResult {
  ads: number;
  snapshots: number;
  newlyFatigued: string[];
}

/**
 * Pulls ads, creative metadata, daily ad-level metrics and the live budget into the database.
 * Re-fetches the last `days` days because platforms revise recent numbers.
 * Triggers a creative analysis when a creative crosses into fatigue mid-cycle.
 */
export async function syncPerformance(deps: Deps, campaignId: string, days = 3): Promise<SyncResult> {
  const { db } = deps;
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { adAccount: true, brief: true } });
  const platform = deps.platformFor(campaign.adAccount);
  const now = deps.now();

  let ads, insights, budget;
  try {
    ads = await platform.listAds(campaign.platformCampaignId);
    const videoLengths = await platform.getVideoLengths(ads.flatMap((a) => (a.videoId ? [a.videoId] : [])));
    insights = await platform.getAdDailyInsights(campaign.platformCampaignId, isoDate(addDays(now, -(days - 1))), isoDate(now));
    budget = await platform.getBudgetTarget(campaign.platformCampaignId);

    for (const a of ads) {
      const platformFields = {
        name: a.name,
        status: a.status,
        format: a.format,
        lengthSec: a.videoId ? (videoLengths[a.videoId] ?? null) : null,
        thumbnailUrl: a.thumbnailUrl,
      };
      await db.ad.upsert({
        where: { campaignId_platformAdId: { campaignId, platformAdId: a.id } },
        // Never overwrite client tags (angle, style, tone) or a format the client corrected (e.g. "ugc").
        update: { name: a.name, status: a.status, lengthSec: platformFields.lengthSec, thumbnailUrl: a.thumbnailUrl },
        create: { campaignId, platformAdId: a.id, ...platformFields, launchedAt: a.createdAt },
      });
    }
  } catch (e) {
    if (e instanceof MetaApiError && e.isAuthError) {
      await notifyUser(deps, campaign.userId, templates.reconnectRequired(campaign.adAccount.name ?? campaign.adAccount.accountId, `${deps.appUrl}/settings/accounts`));
    }
    throw e;
  }

  for (const r of insights) {
    const values = {
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
      cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
      roas: r.spend > 0 ? r.revenue / r.spend : 0,
      cpa: r.conversions > 0 ? r.spend / r.conversions : null,
      conversions: r.conversions,
      revenue: r.revenue,
      frequency: r.frequency,
      thumbStopRate: r.thumbStopRate,
      videoCompletionRate: r.videoCompletionRate,
      fetchedAt: now,
    };
    const date = new Date(`${r.date}T00:00:00Z`);
    await db.performanceSnapshot.upsert({
      where: { campaignId_adId_date: { campaignId, adId: r.adId, date } },
      update: values,
      create: { campaignId, adId: r.adId, date, ...values },
    });
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { currentDailyBudget: budget.dailyBudget, budgetLevel: budget.level, budgetEntityId: budget.id, lastSyncedAt: now },
  });

  // Mid-cycle fatigue: any creative newly fatigued since the last brief triggers Phase 1.
  let newlyFatigued: string[] = [];
  if (campaign.brief && campaign.status === "active") {
    const t = briefThresholds(campaign.brief);
    const [adRows, snaps, lastBrief] = await Promise.all([
      db.ad.findMany({ where: { campaignId, retiredAt: null } }),
      db.performanceSnapshot.findMany({ where: { campaignId, date: { gte: addDays(now, -14) } } }),
      db.creativeBrief.findFirst({ where: { campaignId }, orderBy: { generatedAt: "desc" } }),
    ]);
    const fatigued = detectFatigue(toCreativeInputs(adRows, snaps), {
      healthyRoas: t.targets.targetRoas,
      targetCpa: t.targets.targetCpa,
      noConversionSpend: t.targets.targetCpa * 2,
      frequencyThreshold: t.fatigue.frequency,
      ctrDeclinePct: t.fatigue.ctrDeclinePct,
      roasDegradePct: t.fatigue.roasDegradePct,
    });
    const known = new Set(((lastBrief?.creativesToRetire as { adId: string }[] | undefined) ?? []).map((r) => r.adId));
    newlyFatigued = fatigued.map((f) => f.adId).filter((id) => !known.has(id));
    if (newlyFatigued.length && lastBrief) await deps.enqueue.creativeAnalysis(campaignId, "fatigue");
  }

  return { ads: ads.length, snapshots: insights.length, newlyFatigued };
}

