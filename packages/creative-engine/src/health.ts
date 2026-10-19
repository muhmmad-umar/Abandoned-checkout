import { lerpClamped, refreshIntervalDays, type RefreshFrequency } from "@ad-scaler/shared";
import type { FatiguedCreative, RankedCreative } from "./types";

export interface CreativeHealthOptions {
  now: Date;
  refreshFrequency: RefreshFrequency;
  /** Angles from the client's taxonomy not yet tested. */
  untestedAngleCount: number;
}

/**
 * Creative Health Score, 0-100:
 * - 40 pts: share of active creatives that are healthy (not fatigued)
 * - 20 pts: share of the angle taxonomy already tested
 * - 20 pts: recency of the last refresh vs the client's refresh frequency
 *           (full within one interval, zero at two intervals or no refresh on record)
 * - 20 pts: trend of the top-quartile creatives (improving 1, stable 0.6, declining 0)
 * Phase 2 blocks budget scaling below the client's threshold (default 60).
 * @param scored output of scoreCreatives
 * @param lastRefreshDate when the newest creative went live
 */
export function calculateCreativeHealthScore(
  scored: RankedCreative[],
  fatigued: FatiguedCreative[],
  lastRefreshDate: Date | null,
  opts: CreativeHealthOptions,
): number {
  const active = scored.filter((c) => c.metrics.spend > 0);
  if (active.length === 0) return 0;
  const fatiguedIds = new Set(fatigued.map((f) => f.adId));
  const healthyShare = active.filter((c) => !fatiguedIds.has(c.adId)).length / active.length;

  const tested = new Set(active.map((c) => c.attributes.angle).filter(Boolean)).size;
  const coverage = tested + opts.untestedAngleCount > 0 ? tested / (tested + opts.untestedAngleCount) : 1;

  const interval = refreshIntervalDays(opts.refreshFrequency);
  const daysSince = lastRefreshDate ? (opts.now.getTime() - lastRefreshDate.getTime()) / 86_400_000 : Infinity;
  const recency = Number.isFinite(daysSince) ? lerpClamped(daysSince, interval, interval * 2, 1, 0) : 0;

  const ranked = active.filter((c) => c.score != null);
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 4)));
  const trendVal = { improving: 1, stable: 0.6, declining: 0 } as const;
  const trend = top.length ? top.reduce((a, c) => a + trendVal[c.trend], 0) / top.length : 0.6;

  return Math.round(40 * healthyShare + 20 * coverage + 20 * recency + 20 * trend);
}
