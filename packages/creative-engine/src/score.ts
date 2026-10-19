import { mean, safeDiv } from "@ad-scaler/shared";
import type { CreativeDailyMetrics, CreativeInput, CreativeTrend, CreativeWindowMetrics, RankedCreative, ScoringWeights } from "./types";

export const DEFAULT_WEIGHTS: ScoringWeights = {
  hookRate: 0.15,
  ctr: 0.2,
  efficiency: 0.3,
  completionRate: 0.1,
  frequency: 0.05,
  costPerResult: 0.1,
  trend: 0.1,
};

export interface ScoreOptions {
  weights?: Partial<ScoringWeights>;
  /** Window length in days; the prior window of equal length is used for trend. Default 7. */
  windowDays?: number;
  /** Minimum impressions in the window to be scored. Default 1000. */
  minImpressions?: number;
  /** Last date of the window (YYYY-MM-DD). Defaults to the latest date in the data. */
  asOf?: string;
}

/** Latest date across all creatives' daily rows. */
export function latestDate(creatives: CreativeInput[]): string {
  let max = "";
  for (const c of creatives) for (const d of c.daily) if (d.date > max) max = d.date;
  return max;
}

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Splits rows into the current window and the prior window ending at `asOf`. */
export function splitWindows(daily: CreativeDailyMetrics[], asOf: string, windowDays: number) {
  // No data anywhere in the campaign yet (e.g. a brand-new campaign).
  if (!asOf) return { current: [] as CreativeDailyMetrics[], prior: [] as CreativeDailyMetrics[] };
  const curStart = shiftIso(asOf, -(windowDays - 1));
  const priorStart = shiftIso(asOf, -(2 * windowDays - 1));
  return {
    current: daily.filter((d) => d.date >= curStart && d.date <= asOf),
    prior: daily.filter((d) => d.date >= priorStart && d.date < curStart),
  };
}

/** Aggregates daily rows. Hook and completion rates are impression-weighted. */
export function windowMetrics(rows: CreativeDailyMetrics[]): CreativeWindowMetrics {
  const sum = (f: (r: CreativeDailyMetrics) => number) => rows.reduce((a, r) => a + f(r), 0);
  const spend = sum((r) => r.spend);
  const impressions = sum((r) => r.impressions);
  const clicks = sum((r) => r.clicks);
  const conversions = sum((r) => r.conversions);
  const revenue = sum((r) => r.revenue);
  const weighted = (k: "thumbStopRate" | "videoCompletionRate") => {
    const rs = rows.filter((r) => r[k] != null);
    const imp = rs.reduce((a, r) => a + r.impressions, 0);
    return rs.length && imp > 0 ? rs.reduce((a, r) => a + r[k]! * r.impressions, 0) / imp : null;
  };
  return {
    spend, impressions, clicks, conversions, revenue,
    ctr: safeDiv(clicks, impressions) ?? 0,
    roas: safeDiv(revenue, spend) ?? 0,
    cpa: safeDiv(spend, conversions),
    cpc: safeDiv(spend, clicks),
    frequency: mean(rows.map((r) => r.frequency)),
    hookRate: weighted("thumbStopRate"),
    completionRate: weighted("videoCompletionRate"),
  };
}

/**
 * Week-over-week trend on the creative's primary metric: ROAS when both windows converted,
 * otherwise CTR. ±10% is "stable".
 */
export function creativeTrend(cur: CreativeWindowMetrics, prior: CreativeWindowMetrics | null): CreativeTrend {
  if (!prior || prior.impressions === 0) return "stable";
  const useRoas = cur.revenue > 0 && prior.revenue > 0;
  const a = useRoas ? prior.roas : prior.ctr;
  const b = useRoas ? cur.roas : cur.ctr;
  if (a <= 0) return "stable";
  const change = (b - a) / a;
  return change >= 0.1 ? "improving" : change <= -0.1 ? "declining" : "stable";
}

/** Fraction of `pool` below `v` (ties count half). Single-value pools score 0.5. */
function percentile(v: number, pool: number[]): number {
  if (pool.length <= 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const p of pool) {
    if (p < v) below++;
    else if (p === v) equal++;
  }
  return (below + (equal - 1) / 2) / (pool.length - 1);
}

/**
 * Scores every creative 0-100 against the others in the same campaign.
 * Each metric becomes a percentile rank (inverted where lower is better), then a weighted mean.
 * Metrics a creative does not have (e.g. hook rate on a static) are dropped from its weights,
 * so formats are compared fairly. Creatives under `minImpressions` get `score: null`.
 * @returns all creatives, scored ones first by score descending
 */
export function scoreCreatives(creatives: CreativeInput[], opts: ScoreOptions = {}): RankedCreative[] {
  const w = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const windowDays = opts.windowDays ?? 7;
  const minImpressions = opts.minImpressions ?? 1000;
  const asOf = opts.asOf ?? latestDate(creatives);

  const rows = creatives.map((c) => {
    const { current, prior } = splitWindows(c.daily, asOf, windowDays);
    const metrics = windowMetrics(current);
    const priorMetrics = prior.length ? windowMetrics(prior) : null;
    return { c, metrics, priorMetrics, trend: creativeTrend(metrics, priorMetrics), enough: metrics.impressions >= minImpressions };
  });
  const scored = rows.filter((r) => r.enough);
  const anyRevenue = scored.some((r) => r.metrics.revenue > 0);
  const efficiencyOf = (m: CreativeWindowMetrics) => (anyRevenue ? m.roas : m.cpa == null ? -Infinity : -m.cpa);

  const pools = {
    hookRate: scored.flatMap((r) => (r.metrics.hookRate == null ? [] : [r.metrics.hookRate])),
    ctr: scored.map((r) => r.metrics.ctr),
    efficiency: scored.map((r) => efficiencyOf(r.metrics)),
    completionRate: scored.flatMap((r) => (r.metrics.completionRate == null ? [] : [r.metrics.completionRate])),
    frequency: scored.map((r) => -r.metrics.frequency),
    costPerResult: scored.map((r) => (r.metrics.cpa == null ? -Infinity : -r.metrics.cpa)),
  };
  const trendValue: Record<CreativeTrend, number> = { improving: 1, stable: 0.5, declining: 0 };

  const out: RankedCreative[] = rows.map((r) => {
    let score: number | null = null;
    if (r.enough) {
      const parts: [number, number][] = [
        [w.ctr, percentile(r.metrics.ctr, pools.ctr)],
        [w.efficiency, percentile(efficiencyOf(r.metrics), pools.efficiency)],
        [w.frequency, percentile(-r.metrics.frequency, pools.frequency)],
        [w.costPerResult, percentile(r.metrics.cpa == null ? -Infinity : -r.metrics.cpa, pools.costPerResult)],
        [w.trend, trendValue[r.trend]],
      ];
      if (r.metrics.hookRate != null) parts.push([w.hookRate, percentile(r.metrics.hookRate, pools.hookRate)]);
      if (r.metrics.completionRate != null) parts.push([w.completionRate, percentile(r.metrics.completionRate, pools.completionRate)]);
      const totalW = parts.reduce((a, [wt]) => a + wt, 0);
      score = totalW > 0 ? Math.round((100 * parts.reduce((a, [wt, v]) => a + wt * v, 0)) / totalW) : 0;
    }
    return {
      adId: r.c.adId, name: r.c.name, attributes: r.c.attributes,
      score, rank: null, hasEnoughData: r.enough, trend: r.trend, metrics: r.metrics, priorMetrics: r.priorMetrics,
    };
  });

  out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.metrics.spend - a.metrics.spend);
  out.forEach((c, i) => (c.rank = c.score == null ? null : i + 1));
  return out;
}
