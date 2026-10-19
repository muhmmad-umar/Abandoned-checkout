import { ArrowRight, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, type Tone } from "@/components/ui/status";
import { apiGet } from "@/lib/api";
import type { CampaignView, CycleRow } from "@/lib/types";
import { fmtCount, fmtMoney, shortDate } from "@/lib/utils";
import { HealthChart } from "./health-chart";

const OUTCOME: Record<string, { tone: Tone; label: string }> = {
  better: { tone: "good", label: "Beat the prediction" },
  as_expected: { tone: "accent", label: "As predicted" },
  worse: { tone: "warning", label: "Below prediction" },
};

export async function ScalingTab({ view }: { view: CampaignView }) {
  const { cycles } = await apiGet<{ cycles: CycleRow[] }>(`/campaigns/${view.campaign.id}/cycles`);
  const applied = cycles.filter((c) => c.status !== "failed");
  const projected = view.roadmap?.cycles ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardDescription>Scaling health across cycles</CardDescription>
          <CardTitle>Is there still room to scale?</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthChart points={view.scalingHealthTrend} title="Scaling health score" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="cycle-log" className="space-y-3">
          <h2 id="cycle-log" className="text-sm font-semibold">Scaling cycle log</h2>
          {cycles.length === 0 ? (
            <Card className="p-6 text-sm text-ink-secondary">No budget changes yet. Each change you approve appears here.</Card>
          ) : (
            <ol className="space-y-3">
              {[...cycles].reverse().map((c) => (
                <li key={c.id}>
                  <Card className={c.status === "failed" ? "border-dashed" : undefined}>
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {c.status === "failed" ? "Attempt failed" : `Cycle ${c.cycleNumber}`}
                          <span className="ml-2 text-sm font-normal text-ink-secondary">{shortDate(c.startedAt)}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.earlyTriggerFlag && <Badge tone="warning"><Zap className="h-3 w-3" aria-hidden /> Early — day {c.dayOfCooldownWhenTriggered}</Badge>}
                          {c.overrideFlag && <Badge>Override</Badge>}
                          {c.status === "active" && <Badge tone="accent">Cooling down</Badge>}
                          {c.status === "failed" && <Badge tone="critical">Not applied</Badge>}
                        </div>
                      </div>
                      <p className="text-sm">
                        <span className="font-medium tabular">{fmtMoney(c.budgetBefore)}</span>
                        <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-ink-muted" aria-label="to" />
                        <span className="font-medium tabular">{fmtMoney(c.budgetAfter)}</span>/day
                        <span className="ml-2 text-ink-secondary">
                          +{c.pctChange}% · we said +{c.systemRecommendationPct}%, you chose +{c.clientChosenPct}%
                        </span>
                      </p>
                      <p className="text-sm text-ink-secondary">{c.systemRationale}</p>
                      {c.outcome && (
                        <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3">
                          <StatusPill tone={OUTCOME[c.outcome]!.tone} label={OUTCOME[c.outcome]!.label} />
                          {c.systemNote && <p className="min-w-0 flex-1 text-sm">{c.systemNote}</p>}
                        </div>
                      )}
                      {c.ceilingDetected && c.ceilingReason && <p className="text-sm text-serious-ink">{c.ceilingReason}</p>}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="roadmap" className="space-y-3">
          <h2 id="roadmap" className="text-sm font-semibold">Roadmap: projected vs actual</h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cycle</th>
                  <th className="px-4 py-2.5 text-right font-medium">Projected</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actual</th>
                  <th className="px-4 py-2.5 text-right font-medium">Est. orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular">
                {projected.map((p, i) => {
                  const a = applied[i];
                  return (
                    <tr key={p.cycle} className={!a && applied.length === i ? "bg-accent-soft/30" : undefined}>
                      <td className="px-4 py-2">{p.cycle}{!a && applied.length === i && <span className="ml-2 text-xs text-accent-ink">next</span>}</td>
                      <td className="px-4 py-2 text-right">{fmtMoney(p.budgetAfter)}{p.capped ? "*" : ""}</td>
                      <td className="px-4 py-2 text-right">{a ? fmtMoney(a.budgetAfter) : <span className="text-ink-muted">—</span>}</td>
                      <td className="px-4 py-2 text-right">{fmtCount(p.estimatedOrders)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {projected.some((p) => p.capped) && <p className="px-4 pb-3 text-xs text-ink-muted">* Capped at your max budget of {fmtMoney(view.brief.maxBudgetCap)}</p>}
            <p className="px-4 pb-4 text-xs text-ink-muted">The roadmap adapts at each cycle based on real data. It's a projection, not a guarantee.</p>
          </Card>
        </section>
      </div>
    </div>
  );
}
