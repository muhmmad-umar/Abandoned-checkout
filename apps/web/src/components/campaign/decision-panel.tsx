"use client";

import { ArrowRight, CheckCircle2, Flag, Hourglass, OctagonAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { applyScale, chooseGoal } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { CampaignView } from "@/lib/types";
import { fmtCount, fmtMoney, fmtRoas, plural } from "@/lib/utils";
import { PctChooser } from "./pct-chooser";

type Rec = NonNullable<CampaignView["recommendation"]>;

function useApply(campaignId: string, rec: Rec) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const apply = (clientPct: number, flags: { earlyOverride?: boolean; ceilingOverride?: boolean } = {}) =>
    start(async () => {
      const r = await applyScale(campaignId, { recommendationId: rec.id, clientPct, ...flags });
      setResult(
        r.ok
          ? { ok: true, message: `Budget updated: ${fmtMoney(r.data.budgetBefore)}/day → ${fmtMoney(r.data.budgetAfter)}/day. Cycle ${r.data.cycleNumber} is cooling down until ${new Date(r.data.cooldownEndsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}.` }
          : { ok: false, message: r.message },
      );
    });
  return { pending, result, apply };
}

function Result({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <p role="status" className={result.ok ? "flex gap-2 text-sm text-good-ink" : "flex gap-2 text-sm text-critical-ink"}>
      {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      {result.message}
    </p>
  );
}

/** Budget and orders the client would get at `pct`, capped at their max budget. */
function projection(rec: Rec, pct: number, cap: number) {
  const { budgetBefore, budgetIfApplied, estOrdersAfter } = rec.card;
  const baseOrders = budgetIfApplied > 0 ? (estOrdersAfter * budgetBefore) / budgetIfApplied : estOrdersAfter;
  const after = Math.min(budgetBefore * (1 + pct / 100), cap);
  return { after, orders: Math.round(baseOrders * (after / budgetBefore)), capped: budgetBefore * (1 + pct / 100) > cap };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function RecommendationCard({ view, rec }: { view: CampaignView; rec: Rec }) {
  const sys = rec.verdict.pct;
  const [pct, setPct] = useState<number | null>(sys > 0 ? sys : null);
  const { pending, result, apply } = useApply(view.campaign.id, rec);
  const p = pct == null ? null : projection(rec, pct, view.brief.maxBudgetCap);
  const verdict = sys > 0 ? `+${sys}%` : rec.verdict.action === "pause" ? "Pause scaling" : "Hold this cycle";

  return (
    <Card>
      <CardHeader>
        <CardDescription>Scaling recommendation · cycle {rec.card.cycleNumber}</CardDescription>
        <CardTitle className="text-xl">System verdict: {verdict}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed">{rec.verdict.reason}</p>
        <dl className="divide-y divide-line border-y border-line">
          <Row label="Budget if applied">
            {fmtMoney(rec.card.budgetBefore)}/day <ArrowRight className="inline h-3.5 w-3.5 text-ink-muted" aria-label="to" /> {p ? `${fmtMoney(p.after)}/day` : "unchanged"}
            {p?.capped && <span className="ml-1 font-normal text-ink-secondary">(your max cap)</span>}
          </Row>
          <Row label="Est. orders after">
            {p ? `~${fmtCount(p.orders)}/day` : `~${fmtCount(Math.round((rec.card.estOrdersAfter * rec.card.budgetBefore) / (rec.card.budgetIfApplied || 1)))}/day`}
            <span className="font-normal text-ink-secondary"> (you need {fmtCount(rec.card.targetOrders)})</span>
          </Row>
          <Row label="Progress toward goal">
            Cycle {rec.card.cycleNumber}
            {rec.card.totalCyclesEstimate ? ` of ~${rec.card.totalCyclesEstimate}` : ""}
          </Row>
        </dl>
        <div className="space-y-2">
          <p className="text-sm font-medium">Your choice</p>
          <PctChooser campaignId={view.campaign.id} options={rec.card.options} systemPct={sys} value={pct} onChange={setPct} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={pct == null || pending || result?.ok} onClick={() => pct != null && apply(pct)}>
            {pending ? "Applying…" : pct == null ? "Choose an increase" : `Apply +${pct}%`}
          </Button>
          {sys === 0 && <span className="text-sm text-ink-secondary">Or leave the budget as is — nothing changes until you apply.</span>}
        </div>
        <Result result={result} />
      </CardContent>
    </Card>
  );
}

function CooldownCard({ view, rec }: { view: CampaignView; rec: Rec }) {
  const cd = rec.cooldown!;
  const early = view.earlyScale;
  const [asking, setAsking] = useState(false);
  const sys = rec.verdict.pct;
  const [pct, setPct] = useState<number | null>(sys > 0 ? sys : rec.card.options[0] ?? 10);
  const { pending, result, apply } = useApply(view.campaign.id, rec);
  const elapsed = cd.lengthDays - cd.daysRemaining;

  return (
    <Card>
      <CardHeader>
        <CardDescription>Cooling down · cycle {cd.cycleNumber}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Hourglass className="h-5 w-5 text-accent" aria-hidden /> Next scaling window opens in {plural(cd.daysRemaining, "day")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {view.lastCycle && (
          <p className="flex gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden />
            <span>
              Applied +{view.lastCycle.clientChosenPct}%: {fmtMoney(view.lastCycle.budgetBefore)}/day → {fmtMoney(view.lastCycle.budgetAfter)}/day
              {view.lastCycle.overrideFlag && <span className="text-ink-secondary"> (we suggested +{view.lastCycle.systemRecommendationPct}%)</span>}
            </span>
          </p>
        )}
        <div>
          <div className="flex gap-1" aria-label={`Day ${cd.dayOfCooldown} of ${cd.lengthDays}`}>
            {Array.from({ length: cd.lengthDays }, (_, i) => (
              <span key={i} className={i < elapsed ? "h-2 flex-1 rounded-full bg-accent" : "h-2 flex-1 rounded-full bg-accent-soft"} />
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-secondary">
            Day {cd.dayOfCooldown} of {cd.lengthDays}. We're pulling daily snapshots so you can watch how the campaign responds before the next increase.
          </p>
        </div>

        {!asking ? (
          <Button variant="outline" onClick={() => setAsking(true)}>
            Scale now
          </Button>
        ) : early ? (
          <div className="space-y-4 rounded-lg border border-line bg-page p-4">
            <div>
              <p className="text-xs font-medium text-ink-muted">Early scale request — day {early.dayOfCooldown} of {early.cooldownLength} cooldown</p>
              <p className="mt-1 font-semibold">System verdict: {early.verdict}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{early.reason}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-ink-muted">ROAS</dt><dd className="font-medium">{fmtRoas(early.metrics.roas)}</dd></div>
              <div><dt className="text-ink-muted">CPA</dt><dd className="font-medium">{early.metrics.cpa == null ? "—" : fmtMoney(early.metrics.cpa)}</dd></div>
              <div><dt className="text-ink-muted">Trend</dt><dd className="font-medium capitalize">{early.metrics.trend}</dd></div>
              <div><dt className="text-ink-muted">Orders today</dt><dd className="font-medium">{fmtCount(early.metrics.ordersToday)} <span className="font-normal text-ink-secondary">/ {fmtCount(early.metrics.targetOrders)}</span></dd></div>
            </dl>
            <PctChooser campaignId={view.campaign.id} options={rec.card.options} systemPct={sys} value={pct} onChange={setPct} />
            <div className="flex flex-wrap gap-2">
              <Button variant="default" onClick={() => setAsking(false)}>Wait as recommended</Button>
              <Button variant="outline" disabled={pct == null || pending || result?.ok} onClick={() => pct != null && apply(pct, { earlyOverride: true })}>
                {pending ? "Applying…" : "Scale now anyway"}
              </Button>
            </div>
            <Result result={result} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BlockedCard({ view, rec }: { view: CampaignView; rec: Rec }) {
  const reasons = rec.status === "hard_stop" ? [{ code: "hard_stop", message: rec.message }] : rec.block.reasons;
  const creative = reasons.some((r) => r.code === "creative_health" || r.code === "fatigue");
  return (
    <Card className="border-critical/40">
      <CardHeader>
        <CardDescription>Scaling paused</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          <OctagonAlert className="h-5 w-5 text-critical" aria-hidden /> Action needed before the next increase
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-sm leading-relaxed">
          {reasons.map((r) => <li key={r.code}>{r.message}</li>)}
        </ul>
        {creative && (
          <Button asChild>
            <Link href={`/campaigns/${view.campaign.id}?tab=creative-brief`}>Open creative brief</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CeilingCard({ view, rec }: { view: CampaignView; rec: Rec }) {
  const [going, setGoing] = useState(false);
  const [pct, setPct] = useState<number | null>(rec.card.options[0] ?? 10);
  const { pending, result, apply } = useApply(view.campaign.id, rec);
  return (
    <Card className="border-serious/50">
      <CardHeader>
        <CardDescription>Scaling ceiling</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          <TriangleAlert className="h-5 w-5 text-serious" aria-hidden /> This campaign has reached its scaling ceiling
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">Further increases are likely to reduce performance. Refresh creatives before scaling again — we've started a new creative analysis.</p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-secondary">
          {rec.ceiling.reasons.map((r) => <li key={r.code}>{r.message}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/campaigns/${view.campaign.id}?tab=creative-brief`}>Review creative brief</Link>
          </Button>
          {!going && <Button variant="outline" onClick={() => setGoing(true)}>Continue scaling anyway</Button>}
        </div>
        {going && (
          <div className="space-y-3 rounded-lg border border-line bg-page p-4">
            <p className="text-sm text-ink-secondary">Your call. A smaller step limits the downside if the ceiling holds.</p>
            <PctChooser campaignId={view.campaign.id} options={rec.card.options} systemPct={rec.verdict.pct} value={pct} onChange={setPct} />
            <Button disabled={pct == null || pending || result?.ok} onClick={() => pct != null && apply(pct, { ceilingOverride: true })}>
              {pending ? "Applying…" : `Apply +${pct ?? 0}%`}
            </Button>
            <Result result={result} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalReachedCard({ view }: { view: CampaignView }) {
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(String(Math.round(view.brief.targetDailyConversions * 1.5)));
  const [cap, setCap] = useState(String(view.brief.maxBudgetCap));
  const [msg, setMsg] = useState<string | null>(null);
  const run = (body: Parameters<typeof chooseGoal>[1]) =>
    start(async () => {
      const r = await chooseGoal(view.campaign.id, body);
      setMsg(r.ok ? (r.data.message ?? "New target set — your roadmap has been regenerated.") : r.message);
    });
  return (
    <Card className="border-good/40">
      <CardHeader>
        <CardDescription>Goal reached</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Flag className="h-5 w-5 text-good" aria-hidden /> You've hit {fmtCount(view.brief.targetDailyConversions)} orders/day — your original target
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">What's next?</p>
        <div className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="new-target">New target (orders/day)</Label>
            <Input id="new-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-cap">Max daily budget</Label>
            <Input id="new-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <Button disabled={pending || !Number(target)} onClick={() => run({ choice: "new_target", targetDailyConversions: Number(target), maxBudgetCap: Number(cap) || undefined })}>
            Set a new target
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run({ choice: "maintain" })}>Maintain — switch to monitoring</Button>
          <Button variant="ghost" disabled={pending} onClick={() => run({ choice: "pause" })}>I'm satisfied — pause automation</Button>
        </div>
        {msg && <p role="status" className="text-sm text-ink-secondary">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/** The decision area of the overview: exactly one card for the campaign's current state. */
export function DecisionPanel({ view }: { view: CampaignView }) {
  const rec = view.recommendation;
  if (view.campaign.status === "paused") {
    return <Card className="p-5 text-sm text-ink-secondary">Automation is paused for this campaign. Your budget stays where it is.</Card>;
  }
  if (!rec) {
    return (
      <Card className="p-5">
        <p className="font-medium">Analyzing your campaign</p>
        <p className="mt-1 text-sm text-ink-secondary">Your first recommendation appears after the first performance sync and creative analysis. Nothing changes until you decide.</p>
      </Card>
    );
  }
  switch (rec.status) {
    case "recommend": return <RecommendationCard view={view} rec={rec} />;
    case "cooldown": return <CooldownCard view={view} rec={rec} />;
    case "ceiling": return <CeilingCard view={view} rec={rec} />;
    case "goal_reached": return <GoalReachedCard view={view} />;
    default: return <BlockedCard view={view} rec={rec} />;
  }
}
