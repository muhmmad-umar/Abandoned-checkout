import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { scoreTone, StatusPill } from "@/components/ui/status";
import { apiGet } from "@/lib/api";
import { campaignStatus } from "@/lib/status";
import type { CampaignListItem } from "@/lib/types";
import { cn, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Campaigns" };

function Score({ value, label }: { value: number | null; label: string }) {
  if (value == null) return <span className="text-sm text-ink-muted">—</span>;
  const tone = scoreTone(value);
  const dot = { good: "bg-good", accent: "bg-accent", warning: "bg-warning", critical: "bg-critical", serious: "bg-serious", neutral: "bg-ink-muted" }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-sm" aria-label={`${label} ${value} out of 100`}>
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
      <span className="font-medium tabular">{value}</span>
      <span className="text-ink-muted">/100</span>
    </span>
  );
}

export default async function CampaignsPage() {
  const campaigns = await apiGet<CampaignListItem[]>("/campaigns");
  const needsAttention = campaigns.filter((c) => c.scalingState === "awaiting_client" || c.scalingState === "blocked" || c.scalingState === "ceiling").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {campaigns.length === 0
              ? "Connect an ad account and import a campaign to get started."
              : needsAttention > 0
                ? `${needsAttention} ${needsAttention === 1 ? "campaign needs" : "campaigns need"} your decision.`
                : "Nothing needs your decision right now."}
          </p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="h-4 w-4" aria-hidden /> Import campaign
          </Link>
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No campaigns yet</p>
          <p className="mt-1 text-sm text-ink-secondary">Import a Meta campaign, then fill in its Scaling Brief. Nothing runs until you do.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/settings/accounts">Connect Meta</Link>
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_24px] gap-4 border-b border-line px-5 py-2.5 text-xs font-medium text-ink-muted md:grid">
            <span>Campaign</span>
            <span>Status</span>
            <span>Daily budget</span>
            <span>Creative health</span>
            <span>Scaling health</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {campaigns.map((c) => {
              const s = campaignStatus(c.status, c.scalingState, c.hasBrief);
              return (
                <li key={c.id}>
                  <Link
                    href={c.hasBrief ? `/campaigns/${c.id}` : `/campaigns/${c.id}/setup`}
                    className="grid grid-cols-2 items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-ink/[0.02] md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_24px]"
                  >
                    <span className="col-span-2 min-w-0 md:col-span-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      {c.creativesNeeded ? <span className="text-xs text-ink-secondary">{c.creativesNeeded} new creatives requested</span> : null}
                    </span>
                    <span className="col-span-2 md:col-span-1">
                      <StatusPill tone={s.tone} label={s.label} icon={c.scalingState === "goal_reached" ? "flag" : undefined} />
                    </span>
                    <span className="text-sm">
                      <span className="block text-xs text-ink-muted md:hidden">Daily budget</span>
                      <span className="tabular">{c.currentDailyBudget == null ? "—" : fmtMoney(c.currentDailyBudget)}</span>
                    </span>
                    <span>
                      <span className="block text-xs text-ink-muted md:hidden">Creative health</span>
                      <Score value={c.creativeHealthScore} label="Creative health" />
                    </span>
                    <span>
                      <span className="block text-xs text-ink-muted md:hidden">Scaling health</span>
                      <Score value={c.scalingHealthScore} label="Scaling health" />
                    </span>
                    <ChevronRight className="hidden h-4 w-4 text-ink-muted md:block" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
