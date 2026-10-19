export type Platform = "meta" | "google" | "tiktok";
export type ScalePreference = "conservative" | "moderate" | "aggressive" | "auto";
export type RefreshFrequency = "weekly" | "biweekly" | "monthly" | "adhoc";
export type CreativeFormat = "static" | "video" | "carousel" | "ugc";

/**
 * The Scaling Brief a client submits before any automation runs.
 * Money is in the ad account's currency, major units (dollars, not cents).
 * Optional target fields left `null` are calculated by the system.
 */
export interface ScalingBrief {
  platform: Platform;

  // Section 1: where you are now
  currentDailyBudget: number;
  currentDailySpend: number;
  currentDailyConversions: number;
  currentRoas: number;
  currentCpa: number;
  /** Fraction, e.g. 0.015 for 1.5%. */
  currentCtr: number;
  avgOrderValue: number;
  campaignAgeDays: number;
  activeCreativeCount: number;

  // Section 2: where you want to go
  targetDailyConversions: number;
  targetRoas: number | null;
  targetCpa: number | null;
  targetDailyBudget: number | null;
  targetTimelineWeeks: number | null;

  // Section 3: business constraints
  maxBudgetCap: number;
  minAcceptableRoas: number;
  maxAcceptableCpa: number;
  /** Fraction, e.g. 0.4 for 40%. */
  productMarginPct: number;
  /** ISO dates (YYYY-MM-DD) in the account's time zone. */
  blackoutDates: string[];
  scalePreference: ScalePreference;

  // Section 4: creative inventory
  creativesInProduction: number;
  creativeRefreshFrequency: RefreshFrequency;
  formatsAvailable: CreativeFormat[];
}

/** Brief targets with every blank filled in by the system. */
export interface ResolvedTargets {
  targetRoas: number;
  targetCpa: number;
  targetDailyBudget: number;
  targetDailyConversions: number;
  /** ROAS at which the product breaks even on margin (1 / margin). */
  breakevenRoas: number;
  calculated: { roas: boolean; cpa: boolean; budget: boolean };
}

/** Every internal rule the system auto-sets from a brief. All fields are user-overridable. */
export interface Thresholds {
  targets: ResolvedTargets;
  hardStopMinRoas: number;
  hardStopMaxCpa: number;
  maxBudgetCap: number;
  /** Recommended increase per performance tier, in percent. */
  scalePctByTier: { strong: number; good: number };
  cooldownDays: number;
  lookbackDays: number;
  /** How often Phase 1 runs on schedule. */
  creativeAnalysisIntervalDays: number;
  /** How often new creative batches are briefed, matched to refresh capacity. */
  creativeBriefCadenceDays: number;
  creativeHealthBlockThreshold: number;
  learningPhase: { minAgeDays: number; minConversions: number; minSpend: number };
  ceiling: {
    cpmIncreasePct: number;
    roasDropPct: number;
    cpaOverMaxPct: number;
    decliningEfficiencyCycles: number;
  };
  fatigue: { frequency: number; ctrDeclinePct: number; roasDegradePct: number };
}

const REFRESH_DAYS: Record<RefreshFrequency, number> = { weekly: 7, biweekly: 14, monthly: 28, adhoc: 14 };

/** Days between creative refreshes for a refresh-frequency choice ("ad hoc" plans as bi-weekly). */
export function refreshIntervalDays(f: RefreshFrequency): number {
  return REFRESH_DAYS[f];
}
