import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { StatusPill } from "@/components/ui/status";
import { GOAL_TONE } from "@/lib/status";
import type { CampaignView } from "@/lib/types";
import { fmtCount, fmtMoney, fmtPct, fmtRoas, plural } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  on_track: "On track — scaling as planned",
  slightly_behind: "Slightly behind — consider a creative refresh to keep pace",
  off_track: "Off track — scaling paused, action required",
  ceiling: "Ceiling detected — creatives needed before the next scale",
  goal_reached: "Goal reached — set a new target or switch to monitoring",
};

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={ok ? "h-4 w-4 text-good" : "h-4 w-4 text-warning-ink"} aria-hidden />
      <span className="sr-only">{ok ? "OK:" : "Attention:"}</span>
      {children}
    </span>
  );
}

/** Always-visible goal progress, framed in the client's own target. */
export function GoalHeader({ view }: { view: CampaignView }) {
  const g = view.goal;
  const target = view.brief.targetDailyConversions;
  if (!g) {
    return (
      <Card className="p-5">
        <p className="text-sm text-ink-secondary">Goal: {fmtCount(target)} orders/day</p>
        <p className="mt-1 font-medium">Waiting for the first performance sync — your progress shows up here once data arrives.</p>
      </Card>
    );
  }
  const remaining = g.estCyclesRemaining;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-secondary">Goal progress: {fmtCount(g.targetOrders)} orders/day</p>
        <StatusPill tone={GOAL_TONE[g.status] ?? "neutral"} label={STATUS_LABEL[g.status] ?? g.status} icon={g.status === "goal_reached" ? "flag" : undefined} />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">{fmtCount(g.ordersToday)}</span>
              <span className="text-sm text-ink-secondary">orders today · {fmtPct(g.ordersPct)} of goal</span>
            </div>
            <Meter className="mt-3" value={g.ordersPct} label="Orders vs goal" />
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span>
                Daily spend <span className="font-medium">{fmtMoney(g.dailySpend)}</span>
              </span>
              <span className="text-ink-secondary">{fmtPct(g.spendPctOfTarget)} of target budget</span>
            </div>
            <Meter className="mt-2" value={g.spendPctOfTarget} label="Spend vs target budget" />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-ink-muted">ROAS today</dt>
            <dd className="mt-0.5">
              <Check ok={g.roas.ok}>
                <span className="font-medium">{fmtRoas(g.roas.value)}</span>
                <span className="text-ink-secondary">{g.roas.ok ? "above" : "below"} your {fmtRoas(g.roas.target)} target</span>
              </Check>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">CPA today</dt>
            <dd className="mt-0.5">
              {g.cpa.value == null ? (
                <span className="text-ink-secondary">No conversions yet today</span>
              ) : (
                <Check ok={g.cpa.ok}>
                  <span className="font-medium">{fmtMoney(g.cpa.value)}</span>
                  <span className="text-ink-secondary">{g.cpa.ok ? "below" : "above"} your {fmtMoney(g.cpa.ceiling)} ceiling</span>
                </Check>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Cycles completed</dt>
            <dd className="mt-0.5 font-medium">
              {g.cyclesCompleted}
              {g.cyclesTotalEstimate ? <span className="font-normal text-ink-secondary"> of ~{g.cyclesTotalEstimate}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Est. arrival at goal</dt>
            <dd className="mt-0.5 font-medium">
              {g.status === "goal_reached"
                ? "Reached"
                : remaining == null
                  ? <span className="font-normal text-ink-secondary">Paused until scaling resumes</span>
                  : `${plural(remaining, "more cycle")}${g.estWeeksRemaining ? ` (~${plural(g.estWeeksRemaining, "week")})` : ""}`}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-ink-muted">Next scaling window</dt>
            <dd className="mt-0.5 font-medium">{g.nextWindowInDays > 0 ? `in ${plural(g.nextWindowInDays, "day")}` : "Open now"}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
