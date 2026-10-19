import { RefreshCw, Settings2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreativeBriefTab } from "@/components/campaign/creative-brief-tab";
import { CreativesTab } from "@/components/campaign/creatives-tab";
import { GoalHeader } from "@/components/campaign/goal-header";
import { HistoryTab } from "@/components/campaign/history-tab";
import { OverviewTab } from "@/components/campaign/overview-tab";
import { ScalingTab } from "@/components/campaign/scaling-tab";
import { CampaignTabs, TABS, type TabId } from "@/components/campaign/tabs";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { apiGet } from "@/lib/api";
import { campaignStatus } from "@/lib/status";
import type { CampaignResponse } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const r = await apiGet<CampaignResponse>(`/campaigns/${params.id}`);
  return { title: r.campaign.name };
}

export default async function CampaignPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; submitted?: string } }) {
  const r = await apiGet<CampaignResponse>(`/campaigns/${params.id}`);
  if ("needsBrief" in r) redirect(`/campaigns/${params.id}/setup`);
  const view = r;
  const tab: TabId = TABS.some((t) => t.id === searchParams.tab) ? (searchParams.tab as TabId) : "overview";
  const s = campaignStatus(view.campaign.status, view.campaign.scalingState);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/campaigns" className="text-sm text-ink-secondary hover:text-ink">Campaigns</Link>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{view.campaign.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-secondary">
            <StatusPill tone={s.tone} label={s.label} icon={view.campaign.scalingState === "goal_reached" ? "flag" : undefined} />
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {view.campaign.lastSyncedAt ? `Synced ${relativeTime(view.campaign.lastSyncedAt)}` : "Waiting for first sync"}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/campaigns/${view.campaign.id}/setup`}>
            <Settings2 className="h-4 w-4" aria-hidden /> Scaling Brief
          </Link>
        </Button>
      </div>

      {searchParams.submitted && (
        <p role="status" className="rounded-lg border border-good/30 bg-good-soft px-4 py-3 text-sm text-good-ink">
          Brief submitted. We're syncing your campaign and analyzing creatives — your first recommendation will appear here.
        </p>
      )}

      <GoalHeader view={view} />
      <CampaignTabs id={view.campaign.id} active={tab} />

      {tab === "overview" && <OverviewTab view={view} />}
      {tab === "creatives" && <CreativesTab campaignId={view.campaign.id} />}
      {tab === "creative-brief" && <CreativeBriefTab campaignId={view.campaign.id} />}
      {tab === "scaling" && <ScalingTab view={view} />}
      {tab === "history" && <HistoryTab view={view} />}
    </div>
  );
}
