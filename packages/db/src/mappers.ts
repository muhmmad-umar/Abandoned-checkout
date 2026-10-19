import type { Ad, CampaignBrief, PerformanceSnapshot, Prisma, ScalingCycle } from "@prisma/client";
import type { CreativeFormat, ScalingBrief, Thresholds } from "@ad-scaler/shared";

type Dec = Prisma.Decimal | null | undefined;
const num = (d: Dec): number => (d == null ? 0 : Number(d));
const numOrNull = (d: Dec): number | null => (d == null ? null : Number(d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** DB brief row → engine ScalingBrief. */
export function toScalingBrief(b: CampaignBrief, platform: ScalingBrief["platform"] = "meta"): ScalingBrief {
  return {
    platform,
    currentDailyBudget: num(b.currentDailyBudget),
    currentDailySpend: num(b.currentDailySpend),
    currentDailyConversions: num(b.currentDailyConversions),
    currentRoas: num(b.currentRoas),
    currentCpa: num(b.currentCpa),
    currentCtr: num(b.currentCtr),
    avgOrderValue: num(b.avgOrderValue),
    campaignAgeDays: b.campaignAgeDays,
    activeCreativeCount: b.activeCreativeCount,
    targetDailyConversions: b.targetDailyConversions,
    targetRoas: numOrNull(b.targetRoas),
    targetCpa: numOrNull(b.targetCpa),
    targetDailyBudget: numOrNull(b.targetDailyBudget),
    targetTimelineWeeks: b.targetTimelineWeeks,
    maxBudgetCap: num(b.maxBudgetCap),
    minAcceptableRoas: num(b.minAcceptableRoas),
    maxAcceptableCpa: num(b.maxAcceptableCpa),
    productMarginPct: num(b.productMarginPct),
    blackoutDates: (b.blackoutDates as string[]) ?? [],
    scalePreference: b.scalePreference,
    creativesInProduction: b.creativesInProduction,
    creativeRefreshFrequency: b.creativeRefreshFrequency,
    formatsAvailable: b.formatsAvailable as CreativeFormat[],
  };
}

export function briefThresholds(b: CampaignBrief): Thresholds {
  return b.thresholds as unknown as Thresholds;
}

/** Engine ScalingBrief → Prisma create input (minus relations). */
export function fromScalingBrief(b: ScalingBrief, thresholds: Thresholds) {
  return {
    currentDailyBudget: b.currentDailyBudget,
    currentDailySpend: b.currentDailySpend,
    currentDailyConversions: b.currentDailyConversions,
    currentRoas: b.currentRoas,
    currentCpa: b.currentCpa,
    currentCtr: b.currentCtr,
    avgOrderValue: b.avgOrderValue,
    campaignAgeDays: b.campaignAgeDays,
    activeCreativeCount: b.activeCreativeCount,
    targetDailyConversions: b.targetDailyConversions,
    targetRoas: b.targetRoas,
    targetCpa: b.targetCpa,
    targetDailyBudget: b.targetDailyBudget,
    targetTimelineWeeks: b.targetTimelineWeeks,
    maxBudgetCap: b.maxBudgetCap,
    minAcceptableRoas: b.minAcceptableRoas,
    maxAcceptableCpa: b.maxAcceptableCpa,
    productMarginPct: b.productMarginPct,
    scalePreference: b.scalePreference,
    creativeRefreshFrequency: b.creativeRefreshFrequency,
    creativesInProduction: b.creativesInProduction,
    formatsAvailable: b.formatsAvailable,
    blackoutDates: b.blackoutDates,
    thresholds: thresholds as unknown as Prisma.InputJsonValue,
  };
}

/** Metric point shape stored in trigger_metrics / post_cycle_metrics. */
export interface StoredMetricPoint {
  roas: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  frequency: number;
  dailyConversions: number;
  dailySpend: number;
  efficiency: number;
}

/** DB cycle row → engine CycleRecord. */
export function toCycleRecord(c: ScalingCycle) {
  return {
    cycleNumber: c.cycleNumber,
    status: c.status,
    startedAt: c.startedAt,
    cooldownEndsAt: c.cooldownEndsAt,
    budgetBefore: num(c.budgetBefore),
    budgetAfter: num(c.budgetAfter),
    pctChange: num(c.pctChange),
    systemRecommendationPct: num(c.systemRecommendationPct),
    clientChosenPct: num(c.clientChosenPct),
    overrideFlag: c.overrideFlag,
    earlyTriggerFlag: c.earlyTriggerFlag,
    preMetrics: c.triggerMetrics as unknown as StoredMetricPoint,
    postMetrics: (c.postCycleMetrics as unknown as StoredMetricPoint | null) ?? null,
    outcome: c.outcomeVsPrediction,
  };
}

/** Per-ad daily snapshots → campaign-level daily series. Frequency is impression-weighted. */
export function toCampaignDaily(rows: PerformanceSnapshot[]) {
  const byDate = new Map<string, { date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; freqWeighted: number }>();
  for (const r of rows) {
    const key = iso(r.date);
    const acc = byDate.get(key) ?? { date: key, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, freqWeighted: 0 };
    acc.spend += num(r.spend);
    acc.impressions += r.impressions;
    acc.clicks += r.clicks;
    acc.conversions += num(r.conversions);
    acc.revenue += num(r.revenue);
    acc.freqWeighted += num(r.frequency) * r.impressions;
    byDate.set(key, acc);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ freqWeighted, ...d }) => ({ ...d, frequency: d.impressions > 0 ? freqWeighted / d.impressions : 0 }));
}

/** Ads + their snapshots → engine CreativeInput[]. */
export function toCreativeInputs(ads: Ad[], rows: PerformanceSnapshot[]) {
  const byAd = new Map<string, PerformanceSnapshot[]>();
  for (const r of rows) byAd.set(r.adId, [...(byAd.get(r.adId) ?? []), r]);
  return ads.map((a) => ({
    adId: a.platformAdId,
    name: a.name,
    attributes: {
      format: a.format as CreativeFormat,
      lengthSec: a.lengthSec,
      angle: a.angle,
      visualStyle: a.visualStyle,
      tone: a.tone,
    },
    daily: (byAd.get(a.platformAdId) ?? []).map((r) => ({
      date: iso(r.date),
      spend: num(r.spend),
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: num(r.conversions),
      revenue: num(r.revenue),
      frequency: num(r.frequency),
      thumbStopRate: numOrNull(r.thumbStopRate),
      videoCompletionRate: numOrNull(r.videoCompletionRate),
    })),
  }));
}
