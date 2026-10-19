import type { AdSet, MetricsSnapshot } from "../meta/types.js";

export type Metric = keyof Pick<MetricsSnapshot, "roas" | "cpa" | "spend" | "ctr" | "purchases">;
export type Operator = ">" | ">=" | "<" | "<=";

export interface Condition {
  metric: Metric;
  op: Operator;
  value: number;
}

export type Action =
  | { type: "INCREASE_BUDGET"; percent: number }
  | { type: "DECREASE_BUDGET"; percent: number }
  | { type: "PAUSE" }
  | { type: "DUPLICATE"; budgetPercent?: number };

export interface Rule {
  id: string;
  name: string;
  /** All conditions must hold (AND). */
  conditions: Condition[];
  action: Action;
  /** Minimum hours between firings on the same ad set. */
  cooldownHours: number;
}

export interface Guardrails {
  /** Hard ceiling for any ad set's daily budget (minor units). */
  maxDailyBudget: number;
  /** Hard floor for budget decreases (minor units). */
  minDailyBudget: number;
  /** Max budget increase per ad set per 24h, as a percent. Meta's learning phase resets on large jumps. */
  maxIncreasePercentPer24h: number;
  /** Ignore ad sets with less spend than this: not enough data. */
  minSpendForDecision: number;
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  maxDailyBudget: 100_000,
  minDailyBudget: 500,
  maxIncreasePercentPer24h: 20,
  minSpendForDecision: 1000,
};

export interface EvaluationInput {
  adSet: AdSet;
  metrics: MetricsSnapshot;
  /** Map of ruleId -> last firing time for this ad set. */
  lastFired: Record<string, Date>;
  /** Total percent budget increase already applied to this ad set in the past 24h. */
  increasedPercentLast24h: number;
  now: Date;
}

export type Decision =
  | { kind: "SET_BUDGET"; ruleId: string; adSetId: string; from: number; to: number }
  | { kind: "PAUSE"; ruleId: string; adSetId: string }
  | { kind: "DUPLICATE"; ruleId: string; adSetId: string; dailyBudget: number }
  | { kind: "SKIP"; ruleId: string; adSetId: string; reason: string };
