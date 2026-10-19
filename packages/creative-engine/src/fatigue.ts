import { fmtMoney, fmtPct, fmtRoas } from "@ad-scaler/shared";
import { latestDate, splitWindows, windowMetrics } from "./score";
import type { CreativeInput, FatigueCode, FatiguedCreative } from "./types";

export interface FatigueOptions {
  /** Frequency above which declining performance counts as fatigue. Default 3.5. */
  frequencyThreshold?: number;
  /** CTR drop week over week that counts as fatigue. Default 0.15 (15%). */
  ctrDeclinePct?: number;
  /** ROAS drop on a previously healthy creative. Default 0.2 (20%). */
  roasDegradePct?: number;
  /** ROAS at or above which a creative counts as "healthy" (the client's target ROAS). */
  healthyRoas: number;
  /** 7-day spend with zero conversions that counts as wasted. Typically 2× target CPA. */
  noConversionSpend: number;
  /** CPA multiple of target that counts as "low conversions". Default 3. */
  lowConversionCpaMultiple?: number;
  targetCpa: number;
  windowDays?: number;
  asOf?: string;
}

/**
 * Flags fatigued creatives. A creative is fatigued when ANY of:
 * - frequency above threshold AND CTR or ROAS declining week over week
 * - CTR down ≥15% week over week while spend continued (≥50% of last week's)
 * - spend above the wasted-spend threshold with zero conversions, or a CPA above 3× target
 * - ROAS down ≥20% on a creative that was at or above the client's target last week
 * Only creatives that spent in the current window are considered.
 */
export function detectFatigue(creatives: CreativeInput[], opts: FatigueOptions): FatiguedCreative[] {
  const freqMax = opts.frequencyThreshold ?? 3.5;
  const ctrDrop = opts.ctrDeclinePct ?? 0.15;
  const roasDrop = opts.roasDegradePct ?? 0.2;
  const cpaMult = opts.lowConversionCpaMultiple ?? 3;
  const windowDays = opts.windowDays ?? 7;
  const asOf = opts.asOf ?? latestDate(creatives);

  const out: FatiguedCreative[] = [];
  for (const c of creatives) {
    const { current, prior } = splitWindows(c.daily, asOf, windowDays);
    const cur = windowMetrics(current);
    if (cur.spend <= 0) continue;
    const prev = prior.length ? windowMetrics(prior) : null;
    const reasons: { code: FatigueCode; message: string }[] = [];

    const ctrChange = prev && prev.ctr > 0 ? (cur.ctr - prev.ctr) / prev.ctr : null;
    const roasChange = prev && prev.roas > 0 ? (cur.roas - prev.roas) / prev.roas : null;
    const declining = (ctrChange != null && ctrChange < -0.05) || (roasChange != null && roasChange < -0.05);

    if (cur.frequency > freqMax && declining) {
      reasons.push({ code: "frequency", message: `Frequency is ${cur.frequency.toFixed(1)} (above ${freqMax}) and performance is slipping.` });
    }
    if (ctrChange != null && ctrChange <= -ctrDrop && prev && cur.spend >= prev.spend * 0.5) {
      reasons.push({ code: "ctr_decline", message: `CTR fell ${fmtPct(-ctrChange)} week over week (${fmtPct(prev.ctr, 2)} → ${fmtPct(cur.ctr, 2)}) despite continued spend.` });
    }
    if (cur.conversions === 0 && cur.spend >= opts.noConversionSpend) {
      reasons.push({ code: "spend_no_conversions", message: `Spent ${fmtMoney(cur.spend)} this week with no conversions.` });
    } else if (cur.cpa != null && cur.cpa > opts.targetCpa * cpaMult && cur.spend >= opts.noConversionSpend) {
      reasons.push({ code: "spend_no_conversions", message: `Spent ${fmtMoney(cur.spend)} this week at a ${fmtMoney(cur.cpa)} CPA — over ${cpaMult}× your ${fmtMoney(opts.targetCpa)} target.` });
    }
    if (prev && prev.roas >= opts.healthyRoas && roasChange != null && roasChange <= -roasDrop) {
      reasons.push({ code: "roas_degrade", message: `ROAS dropped from ${fmtRoas(prev.roas)} to ${fmtRoas(cur.roas)} over the last ${windowDays} days.` });
    }
    if (reasons.length) out.push({ adId: c.adId, name: c.name, spend: cur.spend, reasons });
  }
  return out.sort((a, b) => b.spend - a.spend);
}
