import { clamp } from "@ad-scaler/shared";

/**
 * Minimum healthy creatives a campaign should run at a given budget: about one per five
 * daily conversions at target CPA, between 3 and 20.
 */
export function recommendedMinimumCreatives(dailyBudget: number, targetCpa: number): number {
  if (targetCpa <= 0) return 3;
  return clamp(Math.ceil(dailyBudget / targetCpa / 5), 3, 20);
}

/**
 * How many new creatives to brief this cycle:
 *   N = fatigued (each retired creative is replaced)
 *     + max(0, recommended minimum − healthy − fatigued)   (remaining gap after replacements)
 *     + high-potential untested angles
 * The gap term subtracts the replacements so a retired creative is not counted twice.
 * @param healthy active creatives not flagged as fatigued
 * @param fatigued creatives being retired
 * @param untestedAngles high-potential angles to test this cycle
 */
export function calculateCreativesNeeded(
  healthy: number,
  fatigued: number,
  untestedAngles: number,
  recommendedMinimum = 6,
): number {
  return fatigued + Math.max(0, recommendedMinimum - healthy - fatigued) + untestedAngles;
}
