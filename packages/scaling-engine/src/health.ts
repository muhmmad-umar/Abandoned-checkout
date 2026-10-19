import { lerpClamped, relChange } from "@ad-scaler/shared";
import { appliedCycles } from "./ceiling";
import type { CycleRecord, MetricPoint, ScalingMetrics } from "./types";

export type ScalingHealthLabel = "scaling_freely" | "healthy" | "caution" | "ceiling";

export const SCALING_HEALTH_LABELS: Record<ScalingHealthLabel, string> = {
  scaling_freely: "Scaling freely — continue",
  healthy: "Healthy — scale with normal rules",
  caution: "Caution — scale conservatively or hold",
  ceiling: "Ceiling detected — pause scaling, refresh creatives",
};

/** Maps a 0-100 scaling health score to its label band. */
export function scalingHealthLabel(score: number): ScalingHealthLabel {
  if (score >= 80) return "scaling_freely";
  if (score >= 60) return "healthy";
  if (score >= 40) return "caution";
  return "ceiling";
}

/**
 * Scores scaling health 0-100 from five equally weighted components (20 points each):
 * ROAS trend, CPM trend, frequency, CPA trend, and budget-to-result efficiency.
 * Trends are measured from the start of the cycle history (or the prior window when there is
 * no history) to now. Flat or improving earns full points; each degrades to zero at:
 * ROAS -25%, CPM +30%, frequency 4.0+, CPA +25%, efficiency -30%.
 */
export function calculateScalingHealthScore(cycleHistory: CycleRecord[], currentMetrics: ScalingMetrics): number {
  const cycles = appliedCycles(cycleHistory);
  const baseline: MetricPoint | null = cycles[0]?.preMetrics ?? currentMetrics.prior;

  const trendPoints = (change: number | null, worstAt: number) =>
    change == null ? 20 : lerpClamped(change, 0, worstAt, 20, 0);

  const roas = trendPoints(relChange(baseline?.roas, currentMetrics.roas), -0.25);
  const cpm = trendPoints(relChange(baseline?.cpm, currentMetrics.cpm), 0.3);
  const cpa = trendPoints(relChange(baseline?.cpa, currentMetrics.cpa), 0.25);
  const efficiency = trendPoints(relChange(baseline?.efficiency, currentMetrics.efficiency), -0.3);
  let frequency = lerpClamped(currentMetrics.frequency, 2, 4, 20, 0);
  if (currentMetrics.frequencyTrend === "up") frequency = Math.max(0, frequency - 5);

  return Math.round(roas + cpm + cpa + efficiency + frequency);
}
