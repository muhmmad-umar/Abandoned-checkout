"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { answerInsight } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ProfileResponse } from "@/lib/types";

/** Pattern insight shown once after 3+ consistent overrides. */
export function InsightCard({ campaignId, insight }: { campaignId: string; insight: NonNullable<ProfileResponse["insight"]> }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const offer = insight.kind !== "follow_system";
  const answer = (accept: boolean) => start(async () => { await answerInsight(campaignId, insight.kind, accept); setGone(true); });
  return (
    <Card className="flex flex-col gap-4 border-accent/40 p-5 sm:flex-row sm:items-center">
      <Sparkles className="h-5 w-5 shrink-0 text-accent" aria-hidden />
      <p className="flex-1 text-sm">{insight.message}</p>
      <div className="flex gap-2">
        {offer ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => answer(true)}>Update my profile</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => answer(false)}>Keep as is</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => answer(false)}>Got it</Button>
        )}
      </div>
    </Card>
  );
}
