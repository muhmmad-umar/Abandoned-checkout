"use client";

import { useState, useTransition } from "react";
import { importCampaign } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function ImportButton({ accountId, campaign }: { accountId: string; campaign: { id: string; name: string } }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-critical-ink">{error}</span>}
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await importCampaign(accountId, campaign.id, campaign.name); if (r && !r.ok) setError(r.message); })}>
        {pending ? "Importing…" : "Import"}
      </Button>
    </div>
  );
}
