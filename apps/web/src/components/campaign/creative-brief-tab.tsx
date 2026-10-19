import { Ban, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreTone, StatusPill } from "@/components/ui/status";
import { apiCall } from "@/lib/api";
import type { CreativeBriefResponse } from "@/lib/types";
import { humanize, relativeTime } from "@/lib/utils";
import { BriefItemTracker, RunAnalysisButton } from "./brief-item-tracker";

const KIND = { replacement: "Replacement", volume: "More depth", exploration: "New angle test" } as const;
const LENGTH: Record<string, string> = { short: "Under 15s", mid: "15-30s", long: "Over 30s" };

export async function CreativeBriefTab({ campaignId }: { campaignId: string }) {
  const r = await apiCall<CreativeBriefResponse>(`/campaigns/${campaignId}/creative-brief`);
  if (!r.ok) {
    return (
      <Card className="p-8 text-center">
        <p className="font-medium">No creative brief yet</p>
        <p className="mt-1 text-sm text-ink-secondary">The first analysis runs right after your brief is submitted and data has synced.</p>
        <div className="mt-4"><RunAnalysisButton campaignId={campaignId} /></div>
      </Card>
    );
  }
  const b = r.data;
  const done = b.items.filter((i) => i.status === "live").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardDescription>Creative brief · generated {relativeTime(b.generatedAt)}</CardDescription>
            <CardTitle className="text-xl">{b.winningPatterns.summary}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={scoreTone(b.creativeHealthScore)} label={`Creative health ${b.creativeHealthScore}/100`} />
            <RunAnalysisButton campaignId={campaignId} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{b.headline}</p>
          {b.winningPatterns.headline.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {b.winningPatterns.headline.map((p, i) => (
                <li key={p.label} className="rounded-lg border border-line bg-page px-3 py-2 text-sm">
                  <span className="font-medium">{i + 1}. {p.label}</span>
                  <span className="ml-2 text-ink-secondary">{p.count} of top {p.quartileSize} · avg score {p.avgScore}</span>
                </li>
              ))}
            </ul>
          )}
          {b.items.length > 0 && <p className="text-xs text-ink-muted">{done} of {b.items.length} live</p>}
        </CardContent>
      </Card>

      {b.items.length > 0 && (
        <section className="space-y-3" aria-labelledby="to-make">
          <h2 id="to-make" className="text-sm font-semibold">Creatives to make, in priority order</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {b.items.map((it) => (
              <Card key={it.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-xs font-semibold text-page">{it.priority}</span>
                    <Badge tone="accent">{KIND[it.details.kind] ?? "New creative"}</Badge>
                  </div>
                  <CardTitle className="mt-2">
                    {humanize(it.suggestedFormat)} · {humanize(it.suggestedAngle)}
                  </CardTitle>
                  <CardDescription>
                    {[it.details.suggestedLength && LENGTH[it.details.suggestedLength], it.details.suggestedVisualStyle && `${humanize(it.details.suggestedVisualStyle)} visuals`, it.details.suggestedTone && `${humanize(it.details.suggestedTone)} tone`].filter(Boolean).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /><span>{it.rationale}</span></p>
                  <p className="flex gap-2 text-ink-secondary"><Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{it.whatToAvoid}</span></p>
                  <BriefItemTracker campaignId={campaignId} itemId={it.id} status={it.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {b.creativesToRetire.length > 0 && (
        <section className="space-y-3" aria-labelledby="retire">
          <h2 id="retire" className="text-sm font-semibold">Creatives to retire</h2>
          <Card>
            <ul className="divide-y divide-line">
              {b.creativesToRetire.map((c) => (
                <li key={c.adId} className="px-5 py-3 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <p className="mt-0.5 text-ink-secondary">{c.reason}</p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
