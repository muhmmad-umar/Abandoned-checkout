import type { Thresholds } from "@ad-scaler/shared";

export type Direction = "up" | "flat" | "down";

/** One day of campaign-level performance, in major currency units. */
export interface DailyCampaignMetrics {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  frequency: number;
}

/** Point-in-time KPIs. Used for cycle baselines and window comparisons. */
export interface MetricPoint {
  roas: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  frequency: number;
  dailyConversions: number;
  dailySpend: number;
  /** Conversions per unit of spend. */
  efficiency: number;
}

/** Aggregated lookback-window metrics the scaling engine evaluates. */
export interface ScalingMetrics extends MetricPoint {
  windowDays: number;
  spend: number;
  revenue: number;
  conversions: number;
  /** Most recent day in the window. */
  latest: MetricPoint & { date: string };
  /** Same-length window immediately before this one, when data exists. */
  prior: MetricPoint | null;
  /** Latest day's ROAS vs the day before, as a fraction. */
  roasDeltaDoD: number | null;
  /** Window ROAS vs prior window ROAS, as a fraction. */
  roasDeltaWoW: number | null;
  ctrTrend: Direction;
  frequencyTrend: Direction;
  cpmTrend: Direction;
}

export type CycleStatus = "executing" | "active" | "completed" | "failed";
export type Outcome = "better" | "as_expected" | "worse";

/** A budget scaling cycle, as the engine needs to see it. */
export interface CycleRecord {
  cycleNumber: number;
  status: CycleStatus;
  startedAt: Date;
  cooldownEndsAt: Date;
  budgetBefore: number;
  budgetAfter: number;
  pctChange: number;
  systemRecommendationPct: number;
  clientChosenPct: number;
  overrideFlag: boolean;
  earlyTriggerFlag: boolean;
  /** Metrics at decision time. */
  preMetrics: MetricPoint;
  /** Metrics after the cooldown, once evaluated. */
  postMetrics: MetricPoint | null;
  outcome: Outcome | null;
}

export type VerdictTier = "strong" | "good" | "borderline" | "declining" | "hard_stop";

export interface SystemVerdict {
  tier: VerdictTier;
  action: "scale" | "hold" | "pause";
  /** Recommended budget increase in percent; 0 for hold/pause. */
  pct: number;
  /** Client-facing explanation framed in the client's own numbers. */
  reason: string;
  /** Current ROAS as a fraction of target ROAS. */
  roasVsTarget: number;
  /** Cycles to reach target conversions at `pct`, or null if not scaling. */
  cyclesToGoal: number | null;
}

export interface Reason<C extends string = string> {
  code: C;
  message: string;
}

export type BlockCode = "creative_health" | "learning_phase" | "fatigue" | "blackout";
export interface BlockResult {
  blocked: boolean;
  reasons: Reason<BlockCode>[];
}

export type CeilingCode = "cpm_saturation" | "roas_drop" | "frequency_ctr" | "cpa_over_max" | "declining_efficiency";
export interface CeilingResult {
  detected: boolean;
  reasons: Reason<CeilingCode>[];
  /** Client-facing alert when detected. */
  alert: string | null;
}

export interface CooldownState {
  active: boolean;
  cycleNumber: number;
  startedAt: Date;
  endsAt: Date;
  lengthDays: number;
  /** Whole days elapsed since the last change, minimum 1 while active. */
  dayOfCooldown: number;
  daysRemaining: number;
  message: string;
}

export type DecisionStatus = "recommend" | "cooldown" | "blocked" | "ceiling" | "hard_stop" | "goal_reached";

export interface RecommendationCard {
  cycleNumber: number;
  budgetBefore: number;
  budgetIfApplied: number;
  estOrdersAfter: number;
  targetOrders: number;
  /** Estimated total cycles in the journey (completed + remaining). */
  totalCyclesEstimate: number | null;
  options: number[];
  defaultPct: number;
}

export interface ScaleDecision {
  status: DecisionStatus;
  verdict: SystemVerdict;
  block: BlockResult;
  ceiling: CeilingResult;
  cooldown: CooldownState | null;
  card: RecommendationCard;
  /** Headline for the client. */
  message: string;
}

export interface DecisionContext {
  now: Date;
  creativeHealthScore: number;
  /** Share of active creatives flagged as fatigued (0-1). */
  fatiguedShare: number;
  /** Live budget from the ad platform; falls back to the last cycle, then the brief. */
  currentDailyBudget?: number;
  /** Days since launch; defaults to the age given in the brief. */
  campaignAgeDays?: number;
  thresholds?: Thresholds;
  timeZone?: string;
  platformName?: string;
}
