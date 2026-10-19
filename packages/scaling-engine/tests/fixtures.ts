import type { ScalingBrief } from "@ad-scaler/shared";
import type { CycleRecord, DailyCampaignMetrics, MetricPoint } from "../src";

/** The spec's example: $1,000/day → 30 orders/day, aiming for $3,000/day → 100 orders/day. */
export const brief = (over: Partial<ScalingBrief> = {}): ScalingBrief => ({
  platform: "meta",
  currentDailyBudget: 1000,
  currentDailySpend: 980,
  currentDailyConversions: 30,
  currentRoas: 2.1,
  currentCpa: 33.33,
  currentCtr: 0.015,
  avgOrderValue: 70,
  campaignAgeDays: 30,
  activeCreativeCount: 6,
  targetDailyConversions: 100,
  targetRoas: 2,
  targetCpa: 35,
  targetDailyBudget: 3000,
  targetTimelineWeeks: null,
  maxBudgetCap: 3000,
  minAcceptableRoas: 1.5,
  maxAcceptableCpa: 45,
  productMarginPct: 0.5,
  blackoutDates: [],
  scalePreference: "moderate",
  creativesInProduction: 2,
  creativeRefreshFrequency: "biweekly",
  formatsAvailable: ["static", "video", "ugc"],
  ...over,
});

/** `n` days of flat daily metrics ending 2026-01-14, with optional per-day overrides. */
export function days(n: number, base: Partial<DailyCampaignMetrics> = {}, f?: (i: number) => Partial<DailyCampaignMetrics>): DailyCampaignMetrics[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 14 - (n - 1 - i)));
    return {
      date: d.toISOString().slice(0, 10),
      spend: 1000,
      impressions: 100_000,
      clicks: 1500,
      conversions: 50,
      revenue: 2100,
      frequency: 2,
      ...base,
      ...f?.(i),
    };
  });
}

export const point = (over: Partial<MetricPoint> = {}): MetricPoint => ({
  roas: 2.1,
  cpa: 20,
  ctr: 0.015,
  cpm: 10,
  frequency: 2,
  dailyConversions: 50,
  dailySpend: 1000,
  efficiency: 0.05,
  ...over,
});

export const cycle = (over: Partial<CycleRecord> = {}): CycleRecord => ({
  cycleNumber: 1,
  status: "completed",
  startedAt: new Date("2026-01-01T00:00:00Z"),
  cooldownEndsAt: new Date("2026-01-05T00:00:00Z"),
  budgetBefore: 1000,
  budgetAfter: 1200,
  pctChange: 20,
  systemRecommendationPct: 20,
  clientChosenPct: 20,
  overrideFlag: false,
  earlyTriggerFlag: false,
  preMetrics: point(),
  postMetrics: null,
  outcome: null,
  ...over,
});
