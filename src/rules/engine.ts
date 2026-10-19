import type { Condition, Decision, EvaluationInput, Guardrails, Rule } from "./types.js";

function holds(c: Condition, input: EvaluationInput): boolean {
  const v = input.metrics[c.metric];
  if (v === null) return false; // e.g. CPA with zero purchases never matches
  switch (c.op) {
    case ">": return v > c.value;
    case ">=": return v >= c.value;
    case "<": return v < c.value;
    case "<=": return v <= c.value;
  }
}

/**
 * Pure function: given an ad set's state and the rules, returns the decisions to apply.
 * It performs no I/O so the same code backs live runs, dry runs, and backtests.
 */
export function evaluate(rules: Rule[], input: EvaluationInput, g: Guardrails): Decision[] {
  const { adSet, metrics, now } = input;
  const out: Decision[] = [];
  let budget = adSet.dailyBudget;
  let increased = input.increasedPercentLast24h;

  if (adSet.status !== "ACTIVE") return out;

  for (const rule of rules) {
    const skip = (reason: string): Decision => ({ kind: "SKIP", ruleId: rule.id, adSetId: adSet.id, reason });

    if (!rule.conditions.every((c) => holds(c, input))) continue;
    if (metrics.spend < g.minSpendForDecision) {
      out.push(skip("insufficient spend"));
      continue;
    }
    const last = input.lastFired[rule.id];
    if (last && now.getTime() - last.getTime() < rule.cooldownHours * 3_600_000) {
      out.push(skip("cooldown"));
      continue;
    }

    const a = rule.action;
    switch (a.type) {
      case "PAUSE":
        out.push({ kind: "PAUSE", ruleId: rule.id, adSetId: adSet.id });
        return out; // nothing more to do on a paused ad set
      case "INCREASE_BUDGET": {
        const room = g.maxIncreasePercentPer24h - increased;
        const pct = Math.min(a.percent, room);
        if (pct <= 0) { out.push(skip("24h increase cap reached")); break; }
        const to = Math.min(Math.round(budget * (1 + pct / 100)), g.maxDailyBudget);
        if (to <= budget) { out.push(skip("at max budget")); break; }
        out.push({ kind: "SET_BUDGET", ruleId: rule.id, adSetId: adSet.id, from: budget, to });
        increased += ((to - budget) / budget) * 100;
        budget = to;
        break;
      }
      case "DECREASE_BUDGET": {
        const to = Math.max(Math.round(budget * (1 - a.percent / 100)), g.minDailyBudget);
        if (to >= budget) { out.push(skip("at min budget")); break; }
        out.push({ kind: "SET_BUDGET", ruleId: rule.id, adSetId: adSet.id, from: budget, to });
        budget = to;
        break;
      }
      case "DUPLICATE": {
        const to = Math.min(Math.round(budget * ((a.budgetPercent ?? 100) / 100)), g.maxDailyBudget);
        out.push({ kind: "DUPLICATE", ruleId: rule.id, adSetId: adSet.id, dailyBudget: to });
        break;
      }
    }
  }
  return out;
}
