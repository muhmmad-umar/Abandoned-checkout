import { connectMeta } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status";
import { apiGet } from "@/lib/api";
import type { AdAccount } from "@/lib/types";
import { shortDate } from "@/lib/utils";

export const metadata = { title: "Ad accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const accounts = await apiGet<AdAccount[]>("/ad-accounts");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ad accounts</h1>
          <p className="mt-1 text-sm text-ink-secondary">Tokens are encrypted at rest. We only change budgets you approve.</p>
        </div>
        <form action={async () => { "use server"; await connectMeta(); }}>
          <Button type="submit">Connect Meta</Button>
        </form>
      </div>
      {searchParams.connected && <p role="status" className="rounded-lg bg-good-soft px-4 py-3 text-sm text-good-ink">Connected {searchParams.connected} ad account(s).</p>}
      {searchParams.error && (
        <p role="alert" className="rounded-lg bg-critical-soft px-4 py-3 text-sm text-critical-ink">
          {searchParams.error === "denied" ? "Meta access was not granted." : "That connection link expired. Try again."}
        </p>
      )}
      <Card>
        {accounts.length === 0 ? (
          <p className="p-6 text-sm text-ink-secondary">No accounts connected yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium">{a.name ?? a.accountId}</p>
                  <p className="text-xs text-ink-secondary">{a.platform === "meta" ? "Meta" : a.platform} · {a.accountId} · {a.currency}</p>
                </div>
                {a.needsReconnect ? (
                  <StatusPill tone="warning" label={a.tokenExpiresAt ? `Access expires ${shortDate(a.tokenExpiresAt)} — reconnect` : "Reconnect"} />
                ) : (
                  <StatusPill tone="good" label="Connected" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
