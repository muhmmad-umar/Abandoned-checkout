import type { EarlyScaleCard, GoalProgress, OverrideHistoryRow, RoadmapCycle, ScaleDecision, ScalingRoadmap } from "@ad-scaler/scaling-engine";
import type { ScalingBrief, Thresholds } from "@ad-scaler/shared";

/** API responses are JSON: Dates arrive as ISO strings. */
export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type ScalingState = "idle" | "awaiting_client" | "cooldown" | "blocked" | "ceiling" | "goal_reached";
export type CampaignStatus = "draft" | "active" | "monitoring" | "paused";

export interface CampaignListItem {
  id: string;
  name: string;
  status: CampaignStatus;
  scalingState: ScalingState;
  currentDailyBudget: number | null;
  hasBrief: boolean;
  creativeHealthScore: number | null;
  creativesNeeded: number | null;
  scalingHealthScore: number | null;
  scalingHealthLabel: string | null;
}

export interface CampaignView {
  campaign: { id: string; name: string; status: CampaignStatus; scalingState: ScalingState; currentDailyBudget: number | null; lastSyncedAt: string | null };
  brief: ScalingBrief;
  thresholds: Thresholds;
  goal: Json<GoalProgress> | null;
  recommendation: (Json<ScaleDecision> & { id: string; createdAt: string }) | null;
  earlyScale: Json<EarlyScaleCard> | null;
  creativeHealth: { score: number; fatiguedShare: number; blocksScaling: boolean } | null;
  scalingHealth: { score: number; label: string } | null;
  scalingHealthTrend: { at: string; score: number }[];
  roadmap: { cycles: RoadmapCycle[]; estimatedWeeks: number; estimatedCreativesNeeded: number } | null;
  overrideHistory: OverrideHistoryRow[];
  lastCycle: {
    cycleNumber: number; startedAt: string; budgetBefore: number; budgetAfter: number; pctChange: number;
    systemRecommendationPct: number; clientChosenPct: number; overrideFlag: boolean; earlyTriggerFlag: boolean;
    systemNote: string | null; outcome: "better" | "as_expected" | "worse" | null;
  } | null;
}

export type CampaignResponse = CampaignView | { campaign: { id: string; name: string; status: CampaignStatus }; needsBrief: true };

export interface Creative {
  id: string;
  platformAdId: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  format: string;
  lengthSec: number | null;
  angle: string | null;
  visualStyle: string | null;
  tone: string | null;
  score: number | null;
  trend: "improving" | "stable" | "declining" | null;
  fatigued: boolean;
  fatigueReason: string | null;
  ctr: number | null;
  roas: number | null;
  cpa: number | null;
  hookRate: number | null;
  frequency: number | null;
}

export type BriefItemStatus = "pending" | "brief_sent" | "in_production" | "uploaded" | "live";

export interface CreativeBriefResponse {
  id: string;
  creativeHealthScore: number;
  creativesNeeded: number;
  headline: string;
  generatedAt: string;
  winningPatterns: { summary: string; headline: { label: string; count: number; quartileSize: number; avgScore: number }[] };
  creativesToRetire: { adId: string; name: string; reason: string }[];
  items: {
    id: string;
    priority: number;
    suggestedFormat: string;
    suggestedAngle: string;
    rationale: string;
    whatToAvoid: string;
    status: BriefItemStatus;
    details: { kind: "replacement" | "volume" | "exploration"; suggestedLength: string | null; suggestedVisualStyle: string | null; suggestedTone: string | null; replacesAdId: string | null };
  }[];
}

export interface CycleRow {
  id: string;
  cycleNumber: number;
  status: "executing" | "active" | "completed" | "failed";
  startedAt: string;
  cooldownEndsAt: string;
  budgetBefore: number;
  budgetAfter: number;
  pctChange: number;
  systemRecommendationPct: number;
  clientChosenPct: number;
  overrideFlag: boolean;
  earlyTriggerFlag: boolean;
  dayOfCooldownWhenTriggered: number | null;
  systemRationale: string;
  outcome: "better" | "as_expected" | "worse" | null;
  systemNote: string | null;
  ceilingDetected: boolean;
  ceilingReason: string | null;
}

export interface ProfileResponse {
  totalCycles: number;
  totalOverrides: number;
  overrideOutperformedCount: number;
  avgClientVsSystemDelta: number;
  riskAppetite: "conservative" | "moderate" | "aggressive";
  manuallyAdjusted: boolean;
  insight: { kind: "suggest_aggressive" | "suggest_conservative" | "follow_system"; message: string } | null;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AdAccount {
  id: string;
  platform: string;
  accountId: string;
  name: string | null;
  currency: string;
  tokenExpiresAt: string | null;
  needsReconnect: boolean;
}

export type RoadmapPreview = { roadmap: Json<ScalingRoadmap>; thresholds: Thresholds };
