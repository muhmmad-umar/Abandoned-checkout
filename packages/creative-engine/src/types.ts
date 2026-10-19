import type { CreativeFormat } from "@ad-scaler/shared";

export type CreativeTrend = "improving" | "stable" | "declining";
export type LengthBucket = "short" | "mid" | "long";

export interface CreativeDailyMetrics {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  frequency: number;
  /** 3-second views / impressions (video only). */
  thumbStopRate?: number | null;
  /** Completed views / plays (video only). */
  videoCompletionRate?: number | null;
}

/** Creative metadata. Format/length come from the platform; angle/style/tone are tagged by the client. */
export interface CreativeAttributes {
  format: CreativeFormat;
  lengthSec?: number | null;
  angle?: string | null;
  visualStyle?: string | null;
  tone?: string | null;
}

export interface CreativeInput {
  adId: string;
  name: string;
  attributes: CreativeAttributes;
  daily: CreativeDailyMetrics[];
}

export interface CreativeWindowMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  roas: number;
  cpa: number | null;
  cpc: number | null;
  frequency: number;
  hookRate: number | null;
  completionRate: number | null;
}

export interface RankedCreative {
  adId: string;
  name: string;
  attributes: CreativeAttributes;
  /** 0-100, or null when the creative lacks enough data to judge. */
  score: number | null;
  rank: number | null;
  hasEnoughData: boolean;
  trend: CreativeTrend;
  metrics: CreativeWindowMetrics;
  /** Same metrics for the prior window, for week-over-week comparison. */
  priorMetrics: CreativeWindowMetrics | null;
}

/** User-configurable weights. They are normalized, so they need not sum to 1. */
export interface ScoringWeights {
  hookRate: number;
  ctr: number;
  /** ROAS (or CPA, inverted, when there is no revenue). */
  efficiency: number;
  completionRate: number;
  /** Lower is better. */
  frequency: number;
  /** Cost per result, lower is better. */
  costPerResult: number;
  trend: number;
}

export type FatigueCode = "frequency" | "ctr_decline" | "spend_no_conversions" | "roas_degrade";

export interface FatiguedCreative {
  adId: string;
  name: string;
  spend: number;
  reasons: { code: FatigueCode; message: string }[];
}

export type PatternDimension = "format" | "length" | "angle" | "visualStyle" | "tone";

export interface Pattern {
  dimension: PatternDimension;
  value: string;
  label: string;
  /** Creatives with this value in the analysed quartile. */
  count: number;
  quartileSize: number;
  /** Share of the quartile with this value. */
  share: number;
  /** Share in the quartile ÷ share across all scored creatives. */
  lift: number;
  avgScore: number;
}

export interface WinningPatterns {
  /** Best patterns first: over-represented in the top quartile. */
  top: Pattern[];
  /** Over-represented in the bottom quartile and absent from the top patterns. */
  losing: Pattern[];
  topCreativeIds: string[];
}

export type BriefItemStatus = "pending" | "brief_sent" | "in_production" | "uploaded" | "live";

export interface BriefItem {
  priority: number;
  suggestedFormat: string;
  suggestedAngle: string;
  suggestedLength: LengthBucket | null;
  suggestedVisualStyle: string | null;
  suggestedTone: string | null;
  rationale: string;
  whatToAvoid: string;
  kind: "replacement" | "volume" | "exploration";
  /** Fatigued creative this replaces, if any. */
  replacesAdId: string | null;
}

export interface CreativeBrief {
  headline: string;
  summary: string;
  topPatterns: Pattern[];
  creativesNeeded: number;
  items: BriefItem[];
  toRetire: { adId: string; name: string; reason: string }[];
}
