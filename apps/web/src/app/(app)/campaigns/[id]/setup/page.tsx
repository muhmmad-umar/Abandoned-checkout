import Link from "next/link";
import { BriefForm } from "@/components/brief/brief-form";
import { apiGet } from "@/lib/api";
import type { CampaignResponse } from "@/lib/types";

export const metadata = { title: "Scaling Brief" };

export default async function SetupPage({ params }: { params: { id: string } }) {
  const r = await apiGet<CampaignResponse>(`/campaigns/${params.id}`);
  const existing = "needsBrief" in r ? null : r.brief;
  return (
    <div className="space-y-6">
      <div>
        <Link href={existing ? `/campaigns/${params.id}` : "/campaigns"} className="text-sm text-ink-secondary hover:text-ink">
          {existing ? r.campaign.name : "Campaigns"}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Scaling Brief</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
          {existing
            ? "Updating the brief regenerates your roadmap and thresholds from these numbers. Past cycles and logs are kept."
            : `Tell us where ${r.campaign.name} is now and where you want it. Nothing is automated until you submit this, and every budget change will still wait for your OK.`}
        </p>
      </div>
      <BriefForm campaignId={params.id} initial={existing} />
    </div>
  );
}
