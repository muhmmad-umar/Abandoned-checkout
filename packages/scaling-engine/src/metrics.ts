import { mean, relChange, safeDiv } from "@ad-scaler/shared";
import type { DailyCampaignMetrics, Direction, MetricPoint, ScalingMetrics } from "./types";

const FLAT_BAND = 0.05;

/** Classifies a relative change as up/flat/down using a ±5% band. */
export function direction(change: number | null, band = FLAT_BAND): Direction {
  if (change == null || Math.abs(change) < band) return "flat";
  return change > 0 ? "up" : "down";
}

/** Aggregates daily rows into one KPI point. Averages per day over `days` rows. */
export function toMetricPoint(rows: DailyCampaignMetrics[]): MetricPoint {
  const sum = (k: keyof Omit<DailyCampaignMetrics, "date">) => rows.reduce((a, r) => a + r[k], 0);
  const spend = sum("spend");
  const impressions = sum("impressions");
  const conversions = sum("conversions");
  const days = Math.max(rows.length, 1);
  return {
    roas: safeDiv(sum("revenue"), spend) ?? 0,
    cpa: safeDiv(spend, conversions),
    ctr: safeDiv(sum("clicks"), impressions) ?? 0,
    cpm: (safeDiv(spend, impressions) ?? 0) * 1000,
    frequency: mean(rows.map((r) => r.frequency)),
    dailyConversions: conversions / days,
    dailySpend: spend / days,
    efficiency: safeDiv(conversions, spend) ?? 0,
  };
}

/**
 * Builds the lookback-window metrics from daily campaign rows.
 * Trends compare the window to the prior window of equal length; when there is no prior
 * window they compare the second half of the window to the first.
 * @param daily rows in any order; duplicate dates are not merged
 * @param lookbackDays window length (3-7 days per the client's thresholds)
 */
export function aggregateWindow(daily: DailyCampaignMetrics[], lookbackDays: number): ScalingMetrics {
  const rows = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) throw new Error("aggregateWindow requires at least one day of data");
  const window = rows.slice(-lookbackDays);
  const priorRows = rows.slice(-lookbackDays * 2, -lookbackDays);
  const cur = toMetricPoint(window);
  const prior = priorRows.length ? toMetricPoint(priorRows) : null;

  let base = prior;
  let recent = cur;
  if (!base && window.length >= 2) {
    const mid = Math.floor(window.length / 2);
    base = toMetricPoint(window.slice(0, mid));
    recent = toMetricPoint(window.slice(mid));
  }

  const last = window[window.length - 1]!;
  const prev = window[window.length - 2];
  const latest = { ...toMetricPoint([last]), date: last.date };

  return {
    ...cur,
    windowDays: window.length,
    spend: window.reduce((a, r) => a + r.spend, 0),
    revenue: window.reduce((a, r) => a + r.revenue, 0),
    conversions: window.reduce((a, r) => a + r.conversions, 0),
    latest,
    prior,
    roasDeltaDoD: prev ? relChange(toMetricPoint([prev]).roas, latest.roas) : null,
    roasDeltaWoW: prior ? relChange(prior.roas, cur.roas) : null,
    ctrTrend: direction(relChange(base?.ctr, recent.ctr)),
    frequencyTrend: direction(relChange(base?.frequency, recent.frequency)),
    cpmTrend: direction(relChange(base?.cpm, recent.cpm)),
  };
}
