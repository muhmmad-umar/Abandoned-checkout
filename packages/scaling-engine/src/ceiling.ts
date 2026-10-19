import { fmtMoney, fmtPct, fmtRoas, relChange, type ScalingBrief, type Thresholds } from "@ad-scaler/shared";
import { deriveThresholds } from "./targets";
import type { CeilingCode, CeilingResult, CycleRecord, Reason, ScalingMetrics } from "./types";

/** Cycles that actually changed budget, oldest first. */
export function appliedCycles(history: CycleRecord[]): CycleRecord[] {
  return history.filter((c) => c.status !== "failed" && c.status !== "executing").sort((a, b) => a.cycleNumber - b.cycleNumber);
}

/**
 * Detects a scaling ceiling: the point where more budget is likely to reduce performance.
 * Compares current metrics with the metrics at the moment of the last increase. Fires when ANY of:
 * CPM up more than X% (saturation), ROAS down more than X% (budget sensitivity),
 * frequency rising while CTR falls, CPA more than X% over the client's max after a scale,
 * or N consecutive cycles whose efficiency (conversions per dollar) fell by more than X% after scaling.
 * A small efficiency loss per step is normal diminishing returns and does not count.
 */
export function detectCeiling(
  cycleHistory: CycleRecord[],
  currentMetrics: ScalingMetrics,
  clientBrief: ScalingBrief,
  thresholds?: Thresholds,
): CeilingResult {
  const t = (thresholds ?? deriveThresholds(clientBrief)).ceiling;
  const maxCpa = clientBrief.maxAcceptableCpa;
  const cycles = appliedCycles(cycleHistory);
  const last = cycles[cycles.length - 1];
  const reasons: Reason<CeilingCode>[] = [];

  if (last) {
    const base = last.preMetrics;
    const cpmChange = relChange(base.cpm, currentMetrics.cpm);
    if (cpmChange != null && cpmChange > t.cpmIncreasePct) {
      reasons.push({
        code: "cpm_saturation",
        message: `Your CPM rose ${fmtPct(cpmChange)} since the last increase (${fmtMoney(base.cpm)} → ${fmtMoney(currentMetrics.cpm)}) — your audience is saturating at this budget.`,
      });
    }
    const roasChange = relChange(base.roas, currentMetrics.roas);
    if (roasChange != null && roasChange < -t.roasDropPct) {
      reasons.push({
        code: "roas_drop",
        message: `Your ROAS fell ${fmtPct(-roasChange)} after the last increase (${fmtRoas(base.roas)} → ${fmtRoas(currentMetrics.roas)}).`,
      });
    }
    if (currentMetrics.cpa != null && currentMetrics.cpa > maxCpa * (1 + t.cpaOverMaxPct)) {
      reasons.push({
        code: "cpa_over_max",
        message: `Your CPA climbed to ${fmtMoney(currentMetrics.cpa)} after the last increase — more than ${fmtPct(t.cpaOverMaxPct)} over your ${fmtMoney(maxCpa)} max.`,
      });
    }
  }

  if (currentMetrics.frequencyTrend === "up" && currentMetrics.ctrTrend === "down") {
    reasons.push({
      code: "frequency_ctr",
      message: `Frequency is rising (${currentMetrics.frequency.toFixed(1)}) while CTR is falling (${fmtPct(currentMetrics.ctr, 2)}) — people are seeing your ads more and clicking less.`,
    });
  }

  const n = t.decliningEfficiencyCycles;
  const evaluated = cycles.filter((c) => c.postMetrics);
  const tail = evaluated.slice(-n);
  const tolerance = t.efficiencyDropPct ?? 0.05;
  const dropped = (c: CycleRecord) => (relChange(c.preMetrics.efficiency, c.postMetrics!.efficiency) ?? 0) < -tolerance;
  if (tail.length === n && tail.every(dropped)) {
    reasons.push({
      code: "declining_efficiency",
      message: `Each of your last ${n} increases cut conversions per dollar by more than ${fmtPct(tolerance)}.`,
    });
  }

  const detected = reasons.length > 0;
  return {
    detected,
    reasons,
    alert: detected
      ? "Your campaign has reached its scaling ceiling. Further increases are likely to reduce performance. Recommended: refresh creatives before scaling again."
      : null,
  };
}
