import { briefThresholds, toCampaignDaily, toCycleRecord, toScalingBrief, type Prisma } from "@ad-scaler/db";
import { addDays, DAY_MS, isoDate } from "@ad-scaler/shared";
import type { Deps } from "./deps";

/** Loads everything the engines need for one campaign. Throws if no brief has been submitted. */
export async function loadCampaignContext(deps: Pick<Deps, "db" | "now">, campaignId: string, historyDays = 28) {
  const campaign = await deps.db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { brief: true, adAccount: true },
  });
  if (!campaign.brief) throw new Error(`Campaign ${campaignId} has no submitted Scaling Brief`);
  const now = deps.now();
  const since = new Date(`${isoDate(addDays(now, -historyDays))}T00:00:00Z`);
  const [snapshots, cycles] = await Promise.all([
    deps.db.performanceSnapshot.findMany({ where: { campaignId, date: { gte: since } }, orderBy: { date: "asc" } }),
    deps.db.scalingCycle.findMany({ where: { campaignId }, orderBy: { cycleNumber: "asc" } }),
  ]);
  const brief = toScalingBrief(campaign.brief, campaign.adAccount.platform);
  return {
    campaign,
    brief,
    thresholds: briefThresholds(campaign.brief),
    snapshots,
    daily: toCampaignDaily(snapshots),
    cycleRows: cycles,
    cycles: cycles.map(toCycleRecord),
    campaignAgeDays: campaign.launchedAt
      ? Math.floor((now.getTime() - campaign.launchedAt.getTime()) / DAY_MS)
      : brief.campaignAgeDays + Math.floor((now.getTime() - campaign.brief.submittedAt.getTime()) / DAY_MS),
    currentDailyBudget: campaign.currentDailyBudget == null ? undefined : Number(campaign.currentDailyBudget),
  };
}

export type CampaignContext = Awaited<ReturnType<typeof loadCampaignContext>>;

export const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
