import Link from "next/link";
import { ImportButton } from "@/components/settings/import-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiCall, apiGet } from "@/lib/api";
import type { AdAccount } from "@/lib/types";
import { cn, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Import campaign" };

interface PlatformCampaign { id: string; name: string; status: string; dailyBudget: number | null; imported: boolean }

export default async function NewCampaignPage({ searchParams }: { searchParams: { account?: string } }) {
  const accounts = await apiGet<AdAccount[]>("/ad-accounts");
  const selected = accounts.find((a) => a.id === searchParams.account) ?? accounts[0];
  const campaigns = selected ? await apiCall<PlatformCampaign[]>(`/ad-accounts/${selected.id}/platform-campaigns`) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-ink-secondary hover:text-ink">Campaigns</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Import a campaign</h1>
      </div>
      {accounts.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Connect an ad account first</p>
          <Button asChild className="mt-4"><Link href="/settings/accounts">Connect Meta</Link></Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ad accounts">
            {accounts.map((a) => (
              <Link key={a.id} href={`/campaigns/new?account=${a.id}`} role="tab" aria-selected={a.id === selected?.id}
                className={cn("rounded-lg border px-3 py-1.5 text-sm", a.id === selected?.id ? "border-ink bg-ink text-page" : "border-line bg-raised hover:border-ink/40")}>
                {a.name ?? a.accountId}
              </Link>
            ))}
          </div>
          <Card>
            {!campaigns ? null : !campaigns.ok ? (
              <p className="p-6 text-sm text-critical-ink">{campaigns.message}</p>
            ) : campaigns.data.length === 0 ? (
              <p className="p-6 text-sm text-ink-secondary">No campaigns in this account.</p>
            ) : (
              <ul className="divide-y divide-line">
                {campaigns.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="text-xs text-ink-secondary">
                        {c.status.toLowerCase()} · {c.dailyBudget == null ? "ad set budgets" : `${fmtMoney(c.dailyBudget)}/day`}
                      </p>
                    </div>
                    {c.imported ? <Badge>Imported</Badge> : <ImportButton accountId={selected!.id} campaign={c} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
