"use client";

import { useState, useTransition } from "react";
import { saveAngleTaxonomy, saveNotificationPrefs } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { humanize } from "@/lib/utils";

function Toggle({ id, label, detail, checked, onChange }: { id: string; label: string; detail: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-xs text-ink-secondary">{detail}</span>
      </span>
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function NotificationPrefsForm({ initial }: { initial: { email?: boolean; inApp?: boolean; slack?: boolean; slackWebhookUrl?: string | null } }) {
  const [p, setP] = useState({ email: initial.email !== false, inApp: initial.inApp !== false, slack: !!initial.slack, slackWebhookUrl: initial.slackWebhookUrl ?? "" });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card>
      <CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Creative briefs, recommendations, ceilings and outcomes.</CardDescription></CardHeader>
      <CardContent>
        <div className="divide-y divide-line">
          <Toggle id="n-inapp" label="In-app" detail="The bell in the sidebar" checked={p.inApp} onChange={(inApp) => setP({ ...p, inApp })} />
          <Toggle id="n-email" label="Email" detail="Sent to your account email" checked={p.email} onChange={(email) => setP({ ...p, email })} />
          <Toggle id="n-slack" label="Slack" detail="Posts to an incoming webhook" checked={p.slack} onChange={(slack) => setP({ ...p, slack })} />
        </div>
        {p.slack && (
          <div className="mt-2 space-y-1.5">
            <Label htmlFor="slack-url">Slack webhook URL</Label>
            <Input id="slack-url" placeholder="https://hooks.slack.com/services/…" value={p.slackWebhookUrl} onChange={(e) => setP({ ...p, slackWebhookUrl: e.target.value })} />
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveNotificationPrefs({ ...p, slackWebhookUrl: p.slackWebhookUrl.trim() || null });
            setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.issues?.[0]?.message ?? r.message });
          })}>Save</Button>
          {msg && <span role="status" className={msg.ok ? "text-sm text-good-ink" : "text-sm text-critical-ink"}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function AngleTaxonomyForm({ initial }: { initial: string[] }) {
  const [angles, setAngles] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const add = () => {
    const a = draft.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (a && !angles.includes(a)) setAngles([...angles, a]);
    setDraft("");
    setSaved(false);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Creative angles</CardTitle>
        <CardDescription>Name the angles your team works with. Untested ones get suggested in creative briefs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-1.5">
          {angles.map((a) => (
            <li key={a}>
              <button type="button" className="rounded-full bg-ink/5 px-2.5 py-1 text-sm hover:bg-ink/10" aria-label={`Remove ${humanize(a)}`} onClick={() => { setAngles(angles.filter((x) => x !== a)); setSaved(false); }}>
                {humanize(a)} ×
              </button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Label htmlFor="angle" className="sr-only">New angle</Label>
          <Input id="angle" className="max-w-xs" placeholder="e.g. Founder story" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" variant="outline">Add</Button>
        </form>
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => { const r = await saveAngleTaxonomy(angles); if (r.ok) { setAngles(r.data.angleTaxonomy); setSaved(true); } })}>Save angles</Button>
          {saved && <span role="status" className="text-sm text-good-ink">Saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}
