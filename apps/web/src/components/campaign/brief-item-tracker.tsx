"use client";

import { Check, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { requestCreativeAnalysis, updateBriefItem } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { BriefItemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS: { id: BriefItemStatus; label: string }[] = [
  { id: "brief_sent", label: "Brief sent" },
  { id: "in_production", label: "In production" },
  { id: "uploaded", label: "Uploaded" },
  { id: "live", label: "Live" },
];
const ORDER: BriefItemStatus[] = ["pending", "brief_sent", "in_production", "uploaded", "live"];

/** Status per brief item. Click a step to move the item there (forward or back). */
export function BriefItemTracker({ campaignId, itemId, status }: { campaignId: string; itemId: string; status: BriefItemStatus }) {
  const [optimistic, setOptimistic] = useState(status);
  const [, start] = useTransition();
  const at = ORDER.indexOf(optimistic);
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Production status">
      {STEPS.map((s) => {
        const idx = ORDER.indexOf(s.id);
        const reached = at >= idx;
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={optimistic === s.id ? "step" : undefined}
              onClick={() =>
                start(async () => {
                  const next = optimistic === s.id ? ORDER[idx - 1]! : s.id;
                  setOptimistic(next);
                  const r = await updateBriefItem(campaignId, itemId, next);
                  if (!r.ok) setOptimistic(optimistic);
                })
              }
              className={cn(
                "flex w-full flex-col items-start gap-1 rounded-md border-t-2 pt-1.5 text-left text-xs transition-colors",
                reached ? "border-accent text-ink" : "border-line text-ink-muted hover:text-ink",
              )}
            >
              <span className="inline-flex items-center gap-1">
                {reached && <Check className="h-3 w-3 text-accent-ink" aria-hidden />}
                {s.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function RunAnalysisButton({ campaignId }: { campaignId: string }) {
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || queued}
      onClick={() => start(async () => { const r = await requestCreativeAnalysis(campaignId); setQueued(r.ok); })}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
      {queued ? "Analysis queued" : "Re-run analysis"}
    </Button>
  );
}
