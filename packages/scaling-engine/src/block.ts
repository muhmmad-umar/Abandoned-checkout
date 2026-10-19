import { fmtCount, fmtMoney, isoDate, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { deriveThresholds } from "./targets";
import type { BlockResult, Reason, BlockCode } from "./types";

export interface BlockOptions {
  now: Date;
  /** Conversions in the last 7 days, for the learning-phase check. */
  conversionsLast7d: number;
  /** Share of active creatives flagged as fatigued (0-1). */
  fatiguedShare: number;
  thresholds?: Thresholds;
  timeZone?: string;
}

/**
 * Checks the gates that must all pass before Phase 2 may recommend a budget change:
 * creative health above threshold, learning phase exited, fatigue not on a majority of
 * creatives, and today not a blackout date.
 * @param creativeHealthScore latest Phase 1 score (0-100)
 * @param campaignAgeDays days since the campaign launched
 * @param spend spend over the last 7 days
 */
export function shouldBlockScaling(
  creativeHealthScore: number,
  campaignAgeDays: number,
  spend: number,
  brief: ScalingBrief,
  opts: BlockOptions,
): BlockResult {
  const t = opts.thresholds ?? deriveThresholds(brief);
  const reasons: Reason<BlockCode>[] = [];

  if (creativeHealthScore < t.creativeHealthBlockThreshold) {
    reasons.push({
      code: "creative_health",
      message: `Budget scaling is paused. Your creative health score is ${Math.round(creativeHealthScore)}/100. Upload new creatives from your brief before the next scaling cycle.`,
    });
  }

  const lp = t.learningPhase;
  const missing: string[] = [];
  if (campaignAgeDays < lp.minAgeDays) missing.push(`${campaignAgeDays} of ${lp.minAgeDays} days live`);
  if (opts.conversionsLast7d < lp.minConversions) missing.push(`${fmtCount(opts.conversionsLast7d)} of ${lp.minConversions} conversions this week`);
  if (spend < lp.minSpend) missing.push(`${fmtMoney(spend)} of ${fmtMoney(lp.minSpend)} spend this week`);
  if (missing.length) {
    reasons.push({
      code: "learning_phase",
      message: `Your campaign is still in the learning phase (${missing.join(", ")}). We'll start recommending increases once it has enough data to read.`,
    });
  }

  if (opts.fatiguedShare > 0.5) {
    reasons.push({
      code: "fatigue",
      message: `${Math.round(opts.fatiguedShare * 100)}% of your active creatives are fatigued. Scaling into tired creatives usually lowers ROAS — refresh them first.`,
    });
  }

  const today = isoDate(opts.now, opts.timeZone);
  if (brief.blackoutDates.includes(today)) {
    reasons.push({ code: "blackout", message: `Today (${today}) is one of your blackout dates, so automation is paused.` });
  }

  return { blocked: reasons.length > 0, reasons };
}
