import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import type { CampaignView, ProfileResponse } from "@/lib/types";
import { fmtMoney, humanize, shortDate } from "@/lib/utils";
import { InsightCard } from "./insight-card";

interface LogRow {
  id: string;
  actionType: string;
  triggeredBy: "system" | "client_override" | "early_override";
  apiCallStatus: "pending" | "success" | "failed";
  errorMessage: string | null;
  timestamp: string;
  oldValue: { dailyBudget?: number } | null;
  newValue: { dailyBudget?: number; pctChange?: number } | null;
}

const TRIGGER = { system: "Followed recommendation", client_override: "Client override", early_override: "Early override" };

export async function HistoryTab({ view }: { view: CampaignView }) {
  const [profile, logs] = await Promise.all([
    apiGet<ProfileResponse>(`/campaigns/${view.campaign.id}/profile`),
    apiGet<LogRow[]>(`/campaigns/${view.campaign.id}/logs`),
  ]);
  const rows = view.overrideHistory;

  return (
    <div className="space-y-6">
      {profile.insight && <InsightCard campaignId={view.campaign.id} insight={profile.insight} />}

      <Card>
        <CardHeader>
          <CardDescription>Your scaling profile</CardDescription>
          <CardTitle className="text-xl">{humanize(profile.riskAppetite)} risk appetite{profile.manuallyAdjusted ? " (set by you)" : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-ink-muted">Cycles</dt><dd className="text-2xl font-semibold">{profile.totalCycles}</dd></div>
            <div><dt className="text-ink-muted">Overrides</dt><dd className="text-2xl font-semibold">{profile.totalOverrides}</dd></div>
            <div><dt className="text-ink-muted">Overrides that beat us</dt><dd className="text-2xl font-semibold">{profile.overrideOutperformedCount}</dd></div>
            <div>
              <dt className="text-ink-muted">Avg. vs our step</dt>
              <dd className="text-2xl font-semibold">{profile.avgClientVsSystemDelta > 0 ? "+" : ""}{profile.avgClientVsSystemDelta}<span className="text-base font-normal"> pts</span></dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="overrides" className="space-y-3">
        <h2 id="overrides" className="text-sm font-semibold">Override history</h2>
        <Card className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-ink-secondary">No cycles yet.</p>
          ) : (
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cycle</th>
                  <th className="px-4 py-2.5 font-medium">System said</th>
                  <th className="px-4 py-2.5 font-medium">You chose</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...rows].reverse().map((r) => (
                  <tr key={r.cycle}>
                    <td className="px-4 py-2.5 tabular">{r.cycle}{r.early && <span className="ml-1.5 text-xs text-warning-ink">early</span>}</td>
                    <td className="px-4 py-2.5 tabular">{r.systemSaid}</td>
                    <td className={r.clientChose !== r.systemSaid ? "px-4 py-2.5 font-medium tabular" : "px-4 py-2.5 tabular"}>{r.clientChose}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section aria-labelledby="audit" className="space-y-3">
        <h2 id="audit" className="text-sm font-semibold">Audit log</h2>
        <p className="text-xs text-ink-muted">Every budget change is recorded before it's sent to the platform. Entries can't be edited.</p>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Change</th>
                <th className="px-4 py-2.5 font-medium">Triggered by</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-ink-secondary">{shortDate(l.timestamp)} {new Date(l.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                  <td className="px-4 py-2.5 tabular">{l.oldValue?.dailyBudget != null && l.newValue?.dailyBudget != null ? `${fmtMoney(l.oldValue.dailyBudget)} → ${fmtMoney(l.newValue.dailyBudget)}` : humanize(l.actionType)}</td>
                  <td className="px-4 py-2.5">{TRIGGER[l.triggeredBy]}</td>
                  <td className="px-4 py-2.5">
                    {l.apiCallStatus === "success" ? <span className="text-good-ink">Applied</span> : l.apiCallStatus === "failed" ? <span className="text-critical-ink">Failed — {l.errorMessage}</span> : <span className="text-ink-secondary">Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
