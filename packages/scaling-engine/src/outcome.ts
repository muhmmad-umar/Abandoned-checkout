import { fmtRoas, relChange } from "@ad-scaler/shared";
import { appliedCycles } from "./ceiling";
import type { CycleRecord, MetricPoint, Outcome } from "./types";

export type WhoWasRight = "system" | "client" | "aligned" | "inconclusive";

export interface OutcomeResult {
  outcome: Outcome;
  predicted: { dailyConversions: number; roas: number };
  actual: { dailyConversions: number; roas: number };
  /** Absolute ROAS change, e.g. -0.4 for 2.3x → 1.9x. */
  roasDelta: number;
  whoWasRight: WhoWasRight;
  /** One-sentence factual note shown after the cooldown. */
  note: string;
  /** Short label for the Override History table. */
  historyLabel: string;
}

/**
 * Compares a cycle's result after its cooldown with what the system predicted.
 * Prediction: conversions scale with budget and ROAS holds.
 * worse: ROAS down ≥10% or conversions under 85% of predicted.
 * better: ROAS up ≥5% and conversions at or above predicted. Otherwise as_expected.
 */
export function evaluateOutcome(cycle: CycleRecord, postMetrics: MetricPoint): OutcomeResult {
  const pre = cycle.preMetrics;
  const ratio = cycle.budgetBefore > 0 ? cycle.budgetAfter / cycle.budgetBefore : 1;
  const predicted = { dailyConversions: pre.dailyConversions * ratio, roas: pre.roas };
  const actual = { dailyConversions: postMetrics.dailyConversions, roas: postMetrics.roas };
  const roasChange = relChange(pre.roas, postMetrics.roas) ?? 0;
  const convRatio = predicted.dailyConversions > 0 ? actual.dailyConversions / predicted.dailyConversions : 1;
  const roasDelta = Math.round((postMetrics.roas - pre.roas) * 10) / 10;

  const outcome: Outcome =
    roasChange <= -0.1 || convRatio < 0.85 ? "worse" : roasChange >= 0.05 && convRatio >= 1 ? "better" : "as_expected";

  const roasPhrase =
    roasDelta < 0 && outcome === "worse"
      ? `ROAS dropped ${Math.abs(roasDelta).toFixed(1)}x`
      : roasDelta > 0 && outcome === "better"
        ? `ROAS rose to ${fmtRoas(postMetrics.roas)}`
        : outcome === "worse"
          ? `Conversions came in at ${Math.round(convRatio * 100)}% of what the budget should have bought`
          : `ROAS held at ${fmtRoas(postMetrics.roas)}`;

  const sys = cycle.systemRecommendationPct;
  const chose = cycle.clientChosenPct;
  const prefix = `You scaled ${chose}% (we suggested ${sys === 0 ? "holding" : `${sys}%`}).`;

  let whoWasRight: WhoWasRight;
  let note: string;
  let label: string;
  if (!cycle.overrideFlag) {
    whoWasRight = "aligned";
    note = outcome === "worse" ? `${roasPhrase} after the increase. We'll factor that into the next cycle.` : `${roasPhrase} — on track.`;
    label = `${shortPhrase(outcome, roasDelta)} — ${outcome === "worse" ? "below plan" : "on track"}`;
  } else if (chose > sys) {
    whoWasRight = outcome === "worse" ? "system" : "client";
    note = outcome === "worse"
      ? `${prefix} ${roasPhrase} after the increase. A more conservative approach may serve better next cycle.`
      : `${prefix} ${roasPhrase}. Your aggressive call paid off this time.`;
    label = `${shortPhrase(outcome, roasDelta)} — ${whoWasRight === "system" ? "system" : "client"} was right`;
  } else {
    whoWasRight = outcome === "better" ? "system" : outcome === "worse" ? "client" : "inconclusive";
    note = outcome === "better"
      ? `${prefix} ${roasPhrase} — there was room for a stronger move.`
      : outcome === "worse"
        ? `${prefix} ${roasPhrase} even at the smaller step — your caution was warranted.`
        : `${prefix} ${roasPhrase} — a safe step, though a slower one.`;
    label = `${shortPhrase(outcome, roasDelta)} — ${whoWasRight === "inconclusive" ? "no clear call" : `${whoWasRight} was right`}`;
  }
  return { outcome, predicted, actual, roasDelta, whoWasRight, note, historyLabel: label };
}

function shortPhrase(outcome: Outcome, roasDelta: number): string {
  if (outcome === "worse") return roasDelta < 0 ? `ROAS dropped ${Math.abs(roasDelta).toFixed(1)}x` : "Conversions missed";
  if (outcome === "better") return `ROAS up ${roasDelta.toFixed(1)}x`;
  return "ROAS held";
}

export interface OverrideHistoryRow {
  cycle: number;
  systemSaid: string;
  clientChose: string;
  outcome: string;
  early: boolean;
}

/** Rows for the Override History tab, oldest first. Cycles without an outcome yet show "In cooldown". */
export function buildOverrideHistory(cycles: CycleRecord[]): OverrideHistoryRow[] {
  return appliedCycles(cycles).map((c) => ({
    cycle: c.cycleNumber,
    systemSaid: c.systemRecommendationPct === 0 ? "Hold" : `+${c.systemRecommendationPct}%`,
    clientChose: `+${c.clientChosenPct}%`,
    outcome: c.postMetrics ? evaluateOutcome(c, c.postMetrics).historyLabel : "In cooldown",
    early: c.earlyTriggerFlag,
  }));
}

export type RiskAppetite = "conservative" | "moderate" | "aggressive";

export interface ScalingProfile {
  totalCycles: number;
  totalOverrides: number;
  overrideOutperformedCount: number;
  /** Mean of (client % − system %) across cycles. */
  avgClientVsSystemDelta: number;
  riskAppetite: RiskAppetite;
  insight: { kind: "suggest_aggressive" | "suggest_conservative" | "follow_system"; message: string } | null;
}

/**
 * Builds the client's scaling profile from evaluated cycles. An insight appears once the
 * client has 3+ overrides and their last 3 all went the same direction.
 */
export function buildScalingProfile(cycles: CycleRecord[]): ScalingProfile {
  const applied = appliedCycles(cycles);
  const evaluated = applied.filter((c) => c.postMetrics);
  const overrides = evaluated.filter((c) => c.overrideFlag);
  const results = overrides.map((c) => ({ c, r: evaluateOutcome(c, c.postMetrics!) }));
  const clientWins = results.filter((x) => x.r.whoWasRight === "client").length;
  const avgDelta = applied.length
    ? applied.reduce((a, c) => a + (c.clientChosenPct - c.systemRecommendationPct), 0) / applied.length
    : 0;
  const riskAppetite: RiskAppetite = avgDelta > 5 ? "aggressive" : avgDelta < -5 ? "conservative" : "moderate";

  let insight: ScalingProfile["insight"] = null;
  const last3 = overrides.slice(-3);
  if (last3.length === 3) {
    const up = last3.every((c) => c.clientChosenPct > c.systemRecommendationPct);
    const down = last3.every((c) => c.clientChosenPct < c.systemRecommendationPct);
    const window = results.slice(-10);
    const winsInWindow = window.filter((x) => x.r.whoWasRight === "client").length;
    const lossesInWindow = window.filter((x) => x.r.whoWasRight === "system").length;
    if ((up || down) && lossesInWindow > winsInWindow) {
      insight = {
        kind: "follow_system",
        message: `Our recommendations have outperformed your overrides in ${lossesInWindow} of the last ${window.length} cycles. Consider following the system more closely.`,
      };
    } else if (up && winsInWindow > 0) {
      insight = {
        kind: "suggest_aggressive",
        message: `You consistently scale more aggressively than our recommendations. Your overrides have outperformed our suggestions ${winsInWindow} of the last ${window.length} cycles. Want us to update your scaling profile to aggressive?`,
      };
    } else if (down && winsInWindow > 0) {
      insight = {
        kind: "suggest_conservative",
        message: `You consistently scale more cautiously than our recommendations, and it has held up in ${winsInWindow} of the last ${window.length} cycles. Want us to update your scaling profile to conservative?`,
      };
    }
  }
  return {
    totalCycles: applied.length,
    totalOverrides: applied.filter((c) => c.overrideFlag).length,
    overrideOutperformedCount: clientWins,
    avgClientVsSystemDelta: Math.round(avgDelta * 10) / 10,
    riskAppetite,
    insight,
  };
}
