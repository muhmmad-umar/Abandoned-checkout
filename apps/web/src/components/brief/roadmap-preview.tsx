import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoadmapPreview } from "@/lib/types";
import { fmtCount, fmtMoney, fmtRoas, humanize } from "@/lib/utils";

/** The Scaling Roadmap, the creative plan, and the thresholds the brief will set. */
export function RoadmapPreviewCard({ preview, ready }: { preview: RoadmapPreview | null; ready: boolean }) {
  if (!preview) {
    return (
      <Card className="p-6">
        <p className="font-medium">Your Scaling Roadmap</p>
        <p className="mt-1 text-sm text-ink-secondary">{ready ? "Calculating…" : "Fill in the required fields and your projected path appears here."}</p>
      </Card>
    );
  }
  const { roadmap: r, thresholds: t } = preview;
  return (
    <Card>
      <CardHeader>
        <CardDescription>Scaling Roadmap · preview</CardDescription>
        <CardTitle className="text-lg">
          {fmtMoney(r.start.dailyBudget)}/day → {fmtCount(r.start.dailyOrders)} orders, aiming for {fmtMoney(r.target.dailyBudget)}/day → {fmtCount(r.target.dailyOrders)} orders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div>
          <p className="mb-2 text-ink-secondary">Projected path ({r.scalePct}% per cycle, {r.cooldownDays}-day cooldowns)</p>
          <table className="w-full tabular">
            <thead className="text-left text-xs text-ink-muted">
              <tr><th className="py-1 font-medium">Cycle</th><th className="py-1 text-right font-medium">Budget</th><th className="py-1 text-right font-medium">Est. orders</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.cycles.map((c) => (
                <tr key={c.cycle}>
                  <td className="py-1.5">{c.cycle}</td>
                  <td className="py-1.5 text-right">{fmtMoney(Math.round(c.budgetBefore))} → {fmtMoney(Math.round(c.budgetAfter))}{c.capped ? "*" : ""}</td>
                  <td className="py-1.5 text-right">{fmtCount(c.estimatedOrders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-ink-muted">Estimated timeline</dt><dd className="font-medium">~{Math.ceil(r.estimatedWeeks)} weeks</dd></div>
          <div><dt className="text-ink-muted">Creatives needed</dt><dd className="font-medium">{r.estimatedCreativesNeeded.min}-{r.estimatedCreativesNeeded.max}</dd></div>
        </dl>
        <ul className="space-y-1.5 text-ink-secondary">
          {r.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <div className="rounded-lg bg-page p-3">
          <p className="font-medium">Creative requirement plan</p>
          <p className="mt-1 text-ink-secondary">{r.creativePlan}</p>
        </div>
        <div>
          <p className="font-medium">Your thresholds</p>
          <ul className="mt-2 space-y-1 text-ink-secondary">
            <li>Hard stop if ROAS falls below {fmtRoas(t.hardStopMinRoas)} or CPA rises above {fmtMoney(t.hardStopMaxCpa)}</li>
            <li>Never above {fmtMoney(t.maxBudgetCap)}/day</li>
            <li>Steps: +{t.scalePctByTier.good}% when on target, +{t.scalePctByTier.strong}% when well ahead</li>
            <li>{t.cooldownDays}-day cooldown between increases</li>
            <li>Target ROAS {fmtRoas(t.targets.targetRoas)}{t.targets.calculated.roas ? " (calculated)" : ""} · target CPA {fmtMoney(t.targets.targetCpa)}{t.targets.calculated.cpa ? " (calculated)" : ""}</li>
            <li>Scaling pauses if creative health drops below {t.creativeHealthBlockThreshold}/100</li>
            <li>New creatives briefed every {t.creativeBriefCadenceDays} days ({humanize(String(t.creativeBriefCadenceDays === 7 ? "weekly" : t.creativeBriefCadenceDays === 28 ? "monthly" : "bi-weekly"))})</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
