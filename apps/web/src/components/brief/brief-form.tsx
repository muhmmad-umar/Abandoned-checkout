"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { ScalingBrief } from "@ad-scaler/shared";
import { previewRoadmap, submitBrief } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { RoadmapPreview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RoadmapPreviewCard } from "./roadmap-preview";

type Field =
  | "currentDailyBudget" | "currentDailySpend" | "currentDailyConversions" | "currentRoas" | "currentCpa" | "currentCtr"
  | "avgOrderValue" | "campaignAgeDays" | "activeCreativeCount" | "targetDailyConversions" | "targetRoas" | "targetCpa"
  | "targetDailyBudget" | "targetTimelineWeeks" | "maxBudgetCap" | "minAcceptableRoas" | "maxAcceptableCpa" | "productMarginPct"
  | "creativesInProduction";

const OPTIONAL: Field[] = ["targetRoas", "targetCpa", "targetDailyBudget", "targetTimelineWeeks"];
/** Entered as percentages, sent as fractions. */
const PERCENT: Field[] = ["currentCtr", "productMarginPct"];

const PREFS = [
  { id: "conservative", label: "Conservative", detail: "10-20% steps" },
  { id: "moderate", label: "Moderate", detail: "20-30% steps" },
  { id: "aggressive", label: "Aggressive", detail: "30%+ steps" },
  { id: "auto", label: "Let the system decide", detail: "Starts moderate" },
] as const;
const REFRESH = [
  { id: "weekly", label: "Weekly" }, { id: "biweekly", label: "Bi-weekly" }, { id: "monthly", label: "Monthly" }, { id: "adhoc", label: "Ad hoc" },
] as const;
const FORMATS = [
  { id: "static", label: "Static" }, { id: "video", label: "Video" }, { id: "carousel", label: "Carousel" }, { id: "ugc", label: "UGC" },
] as const;

function toValues(b: ScalingBrief | null): Record<Field, string> {
  const v = (n: number | null | undefined, pct = false) => (n == null ? "" : String(pct ? Math.round(n * 10000) / 100 : n));
  return {
    currentDailyBudget: v(b?.currentDailyBudget), currentDailySpend: v(b?.currentDailySpend), currentDailyConversions: v(b?.currentDailyConversions),
    currentRoas: v(b?.currentRoas), currentCpa: v(b?.currentCpa), currentCtr: v(b?.currentCtr, true), avgOrderValue: v(b?.avgOrderValue),
    campaignAgeDays: v(b?.campaignAgeDays), activeCreativeCount: v(b?.activeCreativeCount), targetDailyConversions: v(b?.targetDailyConversions),
    targetRoas: v(b?.targetRoas), targetCpa: v(b?.targetCpa), targetDailyBudget: v(b?.targetDailyBudget), targetTimelineWeeks: v(b?.targetTimelineWeeks),
    maxBudgetCap: v(b?.maxBudgetCap), minAcceptableRoas: v(b?.minAcceptableRoas), maxAcceptableCpa: v(b?.maxAcceptableCpa),
    productMarginPct: v(b?.productMarginPct, true), creativesInProduction: v(b?.creativesInProduction ?? 0),
  };
}

export function BriefForm({ campaignId, initial }: { campaignId: string; initial: ScalingBrief | null }) {
  const [vals, setVals] = useState(() => toValues(initial));
  const [pref, setPref] = useState<ScalingBrief["scalePreference"]>(initial?.scalePreference ?? "moderate");
  const [refresh, setRefresh] = useState<ScalingBrief["creativeRefreshFrequency"]>(initial?.creativeRefreshFrequency ?? "biweekly");
  const [formats, setFormats] = useState<ScalingBrief["formatsAvailable"]>(initial?.formatsAvailable ?? ["static", "video"]);
  const [blackout, setBlackout] = useState<string[]>(initial?.blackoutDates ?? []);
  const [blackoutDraft, setBlackoutDraft] = useState("");
  const [preview, setPreview] = useState<RoadmapPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  /** The payload, or null while required fields are still blank. */
  const payload = useMemo(() => {
    const brief: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(vals) as [Field, string][]) {
      if (raw.trim() === "") {
        if (OPTIONAL.includes(k)) { brief[k] = null; continue; }
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      brief[k] = PERCENT.includes(k) ? n / 100 : n;
    }
    return { brief: { ...brief, scalePreference: pref, creativeRefreshFrequency: refresh, formatsAvailable: formats, blackoutDates: blackout } };
  }, [vals, pref, refresh, formats, blackout]);

  useEffect(() => {
    if (!payload) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await previewRoadmap(campaignId, payload);
      if (!live) return;
      if (r.ok) { setPreview(r.data); setErrors({}); }
      else if (r.issues) setErrors(Object.fromEntries(r.issues.map((i) => [i.path.replace(/^brief\./, ""), i.message])));
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [campaignId, payload]);

  const field = (k: Field, label: string, opts: { prefix?: string; suffix?: string; hint?: string; step?: string } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>
        {label}
        {OPTIONAL.includes(k) && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </Label>
      <div className="relative">
        {opts.prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">{opts.prefix}</span>}
        <Input
          id={k}
          inputMode="decimal"
          className={cn(opts.prefix && "pl-7", opts.suffix && "pr-14")}
          value={vals[k]}
          aria-invalid={!!errors[k]}
          aria-describedby={errors[k] ? `${k}-err` : opts.hint ? `${k}-hint` : undefined}
          placeholder={OPTIONAL.includes(k) ? (k === "targetTimelineWeeks" ? "Any" : "Auto") : undefined}
          onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value.replace(/[^\d.]/g, "") }))}
        />
        {opts.suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">{opts.suffix}</span>}
      </div>
      {errors[k] ? <p id={`${k}-err`} className="text-xs text-critical-ink">{errors[k]}</p> : opts.hint ? <p id={`${k}-hint`} className="text-xs text-ink-muted">{opts.hint}</p> : null}
    </div>
  );

  const choice = (active: boolean) =>
    cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", active ? "border-ink bg-ink text-page" : "border-line bg-raised hover:border-ink/40");

  const submit = () => {
    if (!payload) { setFormError("Fill in every required field first."); return; }
    setFormError(null);
    startSubmit(async () => {
      const r = await submitBrief(campaignId, payload);
      if (r && !r.ok) {
        setFormError(r.message);
        if (r.issues) setErrors(Object.fromEntries(r.issues.map((i) => [i.path.replace(/^brief\./, ""), i.message])));
      }
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardDescription>Section 1</CardDescription><CardTitle>Where you are now</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {field("currentDailyBudget", "Daily budget", { prefix: "$" })}
            {field("currentDailySpend", "Daily spend (actual)", { prefix: "$" })}
            {field("currentDailyConversions", "Daily orders")}
            {field("currentRoas", "Current ROAS", { suffix: "x" })}
            {field("currentCpa", "Current CPA", { prefix: "$" })}
            {field("currentCtr", "Current CTR", { suffix: "%" })}
            {field("avgOrderValue", "Average order value", { prefix: "$" })}
            {field("campaignAgeDays", "Campaign age", { suffix: "days" })}
            {field("activeCreativeCount", "Active creatives")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Section 2</CardDescription>
            <CardTitle>Where you want to go</CardTitle>
            <p className="text-sm text-ink-secondary">Leave a target blank and we'll calculate it from your constraints and margin.</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {field("targetDailyConversions", "Target daily orders")}
            {field("targetRoas", "Target ROAS", { suffix: "x" })}
            {field("targetCpa", "Target CPA", { prefix: "$" })}
            {field("targetDailyBudget", "Target daily budget", { prefix: "$" })}
            {field("targetTimelineWeeks", "Timeline", { suffix: "weeks" })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardDescription>Section 3</CardDescription><CardTitle>Your business constraints</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("maxBudgetCap", "Max daily budget", { prefix: "$", hint: "Hard ceiling — never exceeded, even if you choose a bigger step." })}
              {field("productMarginPct", "Product margin", { suffix: "%", hint: "Used for true profitability and breakeven ROAS." })}
              {field("minAcceptableRoas", "Min acceptable ROAS", { suffix: "x", hint: "Scaling stops if ROAS drops below this." })}
              {field("maxAcceptableCpa", "Max acceptable CPA", { prefix: "$", hint: "Scaling stops if CPA goes above this." })}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Budget increase preference</legend>
              <div className="grid gap-2 sm:grid-cols-4">
                {PREFS.map((p) => (
                  <button key={p.id} type="button" aria-pressed={pref === p.id} className={choice(pref === p.id)} onClick={() => setPref(p.id)}>
                    <span className="block font-medium">{p.label}</span>
                    <span className={cn("text-xs", pref === p.id ? "text-page/80" : "text-ink-secondary")}>{p.detail}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="blackout">Blackout dates <span className="font-normal text-ink-muted">(automation pauses on these days)</span></Label>
              <div className="flex gap-2">
                <Input id="blackout" type="date" className="max-w-[200px]" value={blackoutDraft} onChange={(e) => setBlackoutDraft(e.target.value)} />
                <Button type="button" variant="outline" disabled={!blackoutDraft} onClick={() => { setBlackout((b) => [...new Set([...b, blackoutDraft])].sort()); setBlackoutDraft(""); }}>Add</Button>
              </div>
              {blackout.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {blackout.map((d) => (
                    <li key={d}>
                      <button type="button" className="rounded-full bg-ink/5 px-2.5 py-1 text-xs hover:bg-ink/10" onClick={() => setBlackout((b) => b.filter((x) => x !== d))} aria-label={`Remove ${d}`}>
                        {d} ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardDescription>Section 4</CardDescription><CardTitle>Creative inventory</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("creativesInProduction", "Creatives in production")}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Creative refresh frequency</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {REFRESH.map((r) => (
                  <button key={r.id} type="button" aria-pressed={refresh === r.id} className={choice(refresh === r.id)} onClick={() => setRefresh(r.id)}>{r.label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Formats you can produce</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FORMATS.map((f) => {
                  const on = formats.includes(f.id);
                  return (
                    <button key={f.id} type="button" aria-pressed={on} className={choice(on)}
                      onClick={() => setFormats((cur) => (on ? (cur.length > 1 ? cur.filter((x) => x !== f.id) : cur) : [...cur, f.id]))}>
                      {f.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-ink-muted">Pick several for a mixed set. We only brief formats you can make.</p>
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={submit} disabled={submitting}>{submitting ? "Submitting…" : initial ? "Update brief" : "Submit brief and start"}</Button>
          {formError && <p role="alert" className="flex items-center gap-1.5 text-sm text-critical-ink"><AlertCircle className="h-4 w-4" aria-hidden />{formError}</p>}
        </div>
      </div>

      <div className="xl:sticky xl:top-8 xl:self-start">
        <RoadmapPreviewCard preview={preview} ready={!!payload} />
      </div>
    </div>
  );
}
