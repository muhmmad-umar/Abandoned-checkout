"use client";

import { Pencil } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { tagCreative } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { Creative } from "@/lib/types";
import { humanize } from "@/lib/utils";

const STYLES = ["lifestyle", "product_only", "text_heavy", "minimal", "bold"];
const TONES = ["emotional", "direct_response", "educational", "humorous", "urgent"];

export function TagEditor({ campaignId, creative, angles }: { campaignId: string; creative: Creative; angles: string[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ format: creative.format, angle: creative.angle ?? "", visualStyle: creative.visualStyle ?? "", tone: creative.tone ?? "" });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const tags = [creative.angle && `${humanize(creative.angle)} angle`, creative.visualStyle && humanize(creative.visualStyle), creative.tone && `${humanize(creative.tone)} tone`].filter(Boolean);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {tags.length ? tags.map((t) => <span key={t as string} className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-secondary">{t}</span>) : <span className="text-xs text-warning-ink">Untagged</span>}
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded px-1 text-xs text-accent-ink hover:underline">
          <Pencil className="h-3 w-3" aria-hidden /> Edit tags
        </button>
      </div>
    );
  }
  const norm = (s: string) => (s.trim() ? s.trim().toLowerCase().replace(/[\s-]+/g, "_") : null);
  return (
    <form
      className="mt-2 grid max-w-md grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await tagCreative(campaignId, creative.id, { format: f.format, angle: norm(f.angle), visualStyle: norm(f.visualStyle), tone: norm(f.tone) });
          if (r.ok) setOpen(false);
          else setError(r.message);
        });
      }}
    >
      <label className="text-xs text-ink-secondary">Format
        <Select className="mt-1 h-8" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
          {["static", "video", "carousel", "ugc"].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}
        </Select>
      </label>
      <label className="text-xs text-ink-secondary">Angle
        <Select className="mt-1 h-8" value={f.angle} onChange={(e) => setF({ ...f, angle: e.target.value })}>
          <option value="">—</option>
          {[...new Set([...angles, ...(creative.angle ? [creative.angle] : [])])].map((v) => <option key={v} value={v}>{humanize(v)}</option>)}
        </Select>
      </label>
      <label className="text-xs text-ink-secondary">Visual style
        <Input className="mt-1 h-8" list={`${id}-styles`} value={f.visualStyle} onChange={(e) => setF({ ...f, visualStyle: e.target.value })} />
        <datalist id={`${id}-styles`}>{STYLES.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="text-xs text-ink-secondary">Tone
        <Input className="mt-1 h-8" list={`${id}-tones`} value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} />
        <datalist id={`${id}-tones`}>{TONES.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <div className="col-span-2 flex items-center gap-2">
        <Button size="sm" type="submit" disabled={pending}>{pending ? "Saving…" : "Save tags"}</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        {error && <span className="text-xs text-critical-ink">{error}</span>}
      </div>
    </form>
  );
}
