import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreTone, StatusPill } from "@/components/ui/status";
import type { CampaignView } from "@/lib/types";
import { fmtPct } from "@/lib/utils";
import { DecisionPanel } from "./decision-panel";
import { HealthChart } from "./health-chart";

export function OverviewTab({ view }: { view: CampaignView }) {
  const ch = view.creativeHealth;
  const last = view.lastCycle;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <DecisionPanel view={view} />
        {last?.systemNote && (
          <Card className="p-5">
            <p className="text-xs font-medium text-ink-muted">Cycle {last.cycleNumber} outcome</p>
            <p className="mt-1 text-sm">{last.systemNote}</p>
          </Card>
        )}
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardDescription>Scaling health</CardDescription>
              <CardTitle className="mt-1 text-3xl">{view.scalingHealth ? view.scalingHealth.score : "—"}<span className="text-base font-normal text-ink-muted">/100</span></CardTitle>
            </div>
            {view.scalingHealth && <StatusPill tone={scoreTone(view.scalingHealth.score)} label={view.scalingHealth.label.split(" — ")[0]!} />}
          </CardHeader>
          <CardContent>
            {view.scalingHealth && <p className="mb-4 text-sm text-ink-secondary">{view.scalingHealth.label}</p>}
            <HealthChart points={view.scalingHealthTrend} title="Score over time" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardDescription>Creative health</CardDescription>
              <CardTitle className="mt-1 text-3xl">{ch ? ch.score : "—"}<span className="text-base font-normal text-ink-muted">/100</span></CardTitle>
            </div>
            {ch && <StatusPill tone={ch.blocksScaling ? "critical" : "good"} label={ch.blocksScaling ? "Blocking scaling" : "Clear to scale"} />}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {ch ? (
              <p className="text-ink-secondary">
                {fmtPct(ch.fatiguedShare)} of active creatives show fatigue. Scaling pauses below {view.thresholds.creativeHealthBlockThreshold}.
              </p>
            ) : (
              <p className="text-ink-secondary">The first creative analysis is running.</p>
            )}
            <Link className="font-medium text-accent-ink hover:underline" href={`/campaigns/${view.campaign.id}?tab=creative-brief`}>
              View creative brief →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
