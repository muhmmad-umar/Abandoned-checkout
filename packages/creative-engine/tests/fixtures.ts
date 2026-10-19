import type { CreativeAttributes, CreativeDailyMetrics, CreativeInput } from "../src";

/** 14 days ending 2026-01-14. `prior` applies to days 1-7, `cur` to days 8-14. */
export function creative(
  adId: string,
  attributes: CreativeAttributes,
  cur: Partial<CreativeDailyMetrics>,
  prior: Partial<CreativeDailyMetrics> = cur,
): CreativeInput {
  const daily = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    spend: 100,
    impressions: 10_000,
    clicks: 150,
    conversions: 4,
    revenue: 240,
    frequency: 1.8,
    ...(i < 7 ? prior : cur),
  }));
  return { adId, name: `Ad ${adId}`, attributes, daily };
}

const ugc = { format: "ugc", lengthSec: 12, angle: "pain_point", visualStyle: "lifestyle", tone: "emotional" } as const;
const stat = { format: "static", angle: "offer_led", visualStyle: "text_heavy", tone: "urgent" } as const;

/** 8 creatives: UGC pain-point winners, text-heavy static losers, one fatigued, one too small to score. */
export const campaign = (): CreativeInput[] => [
  creative("u1", ugc, { revenue: 420, clicks: 260, thumbStopRate: 0.38, videoCompletionRate: 0.3 }),
  creative("u2", ugc, { revenue: 400, clicks: 240, thumbStopRate: 0.35, videoCompletionRate: 0.28 }),
  creative("u3", { ...ugc, angle: "social_proof" }, { revenue: 330, clicks: 200, thumbStopRate: 0.3, videoCompletionRate: 0.25 }),
  creative("v1", { format: "video", lengthSec: 40, angle: "demo", visualStyle: "product_only", tone: "educational" }, { revenue: 260, clicks: 160, thumbStopRate: 0.22, videoCompletionRate: 0.12 }),
  creative("s1", stat, { revenue: 150, clicks: 90 }),
  creative("s2", stat, { revenue: 140, clicks: 80 }),
  // Fatigued: high frequency, CTR and ROAS falling.
  creative("f1", { ...ugc, angle: "testimonial" }, { revenue: 180, clicks: 110, frequency: 4.2 }, { revenue: 330, clicks: 200, frequency: 3 }),
  creative("tiny", stat, { impressions: 50, spend: 2, clicks: 1, conversions: 0, revenue: 0 }),
];
