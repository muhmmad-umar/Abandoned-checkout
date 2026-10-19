import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status";
import { apiGet } from "@/lib/api";
import type { Creative } from "@/lib/types";
import { fmtMoney, fmtPct, fmtRoas, humanize, relativeTime } from "@/lib/utils";
import { TagEditor } from "./tag-editor";

const TREND = {
  improving: { icon: ArrowUpRight, label: "Improving", cls: "text-good-ink" },
  stable: { icon: ArrowRight, label: "Stable", cls: "text-ink-secondary" },
  declining: { icon: ArrowDownRight, label: "Declining", cls: "text-critical-ink" },
};

export async function CreativesTab({ campaignId }: { campaignId: string }) {
  const [{ creatives, analyzedAt }, me] = await Promise.all([
    apiGet<{ creatives: Creative[]; analyzedAt: string | null }>(`/campaigns/${campaignId}/creatives`),
    apiGet<{ angleTaxonomy: string[] }>("/me"),
  ]);
  if (creatives.length === 0) {
    return <Card className="p-8 text-center text-sm text-ink-secondary">No creatives synced yet.</Card>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary">
        Ranked by score from the latest analysis{analyzedAt ? ` (${relativeTime(analyzedAt)})` : ""}. Tag each creative's angle, visual style and tone — winning patterns are read from these tags.
      </p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Creative</th>
              <th className="px-4 py-2.5 text-right font-medium">Score</th>
              <th className="px-4 py-2.5 font-medium">Trend</th>
              <th className="px-4 py-2.5 text-right font-medium">ROAS</th>
              <th className="px-4 py-2.5 text-right font-medium">CTR</th>
              <th className="px-4 py-2.5 text-right font-medium">CPA</th>
              <th className="px-4 py-2.5 text-right font-medium">Hook rate</th>
              <th className="px-4 py-2.5 text-right font-medium">Freq.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {creatives.map((c, i) => {
              const t = c.trend ? TREND[c.trend] : null;
              return (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3 text-ink-muted tabular">{c.score == null ? "—" : i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name}</div>
                    <div className="mt-0.5 text-xs text-ink-secondary">
                      {humanize(c.format)}{c.lengthSec ? ` · ${c.lengthSec}s` : ""}
                    </div>
                    {c.fatigued && (
                      <div className="mt-2 max-w-sm space-y-1">
                        <StatusPill tone="serious" label="Fatigued — retire" />
                        {c.fatigueReason && <p className="text-xs text-ink-secondary">{c.fatigueReason}</p>}
                      </div>
                    )}
                    <TagEditor campaignId={campaignId} creative={c} angles={me.angleTaxonomy} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular">{c.score ?? <span className="font-normal text-ink-muted">Not enough data</span>}</td>
                  <td className="px-4 py-3">
                    {t && (
                      <span className={`inline-flex items-center gap-1 ${t.cls}`}>
                        <t.icon className="h-3.5 w-3.5" aria-hidden />
                        {t.label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular">{c.roas == null ? "—" : fmtRoas(c.roas)}</td>
                  <td className="px-4 py-3 text-right tabular">{c.ctr == null ? "—" : fmtPct(c.ctr, 2)}</td>
                  <td className="px-4 py-3 text-right tabular">{c.cpa == null ? "—" : fmtMoney(c.cpa)}</td>
                  <td className="px-4 py-3 text-right tabular">{c.hookRate == null ? "—" : fmtPct(c.hookRate)}</td>
                  <td className="px-4 py-3 text-right tabular">{c.frequency == null ? "—" : c.frequency.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
