"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { previewOpinion } from "@/app/actions";
import { cn } from "@/lib/utils";

/**
 * The client's % choice: preset chips (system pick marked), a custom value, and the
 * system's one inline opinion when the choice differs. The opinion never blocks.
 */
export function PctChooser({
  campaignId, options, systemPct, value, onChange,
}: { campaignId: string; options: number[]; systemPct: number; value: number | null; onChange: (pct: number | null) => void }) {
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [opinion, setOpinion] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (value == null || value === systemPct) {
      setOpinion(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const r = await previewOpinion(campaignId, value);
      if (live) setOpinion(r.ok ? r.data.opinion : null);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [campaignId, value, systemPct]);

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 min-w-[64px] items-center justify-center gap-1 rounded-lg border px-3 text-sm font-medium transition-colors",
      active ? "border-ink bg-ink text-page" : "border-line bg-raised hover:border-ink/40",
    );

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Budget increase" className="flex flex-wrap gap-2">
        {options.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={!custom && value === p}
            className={chip(!custom && value === p)}
            onClick={() => {
              setCustom(false);
              onChange(p);
            }}
          >
            {p}%
            {p === systemPct && <Check className="h-3.5 w-3.5" aria-label="recommended" />}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={chip(custom)}
          onClick={() => {
            setCustom(true);
            const n = Number(customText);
            onChange(n > 0 && n <= 100 ? n : null);
          }}
        >
          Custom
        </button>
        {custom && (
          <span className="inline-flex items-center gap-1">
            <label htmlFor={inputId} className="sr-only">Custom increase percent</label>
            <input
              id={inputId}
              autoFocus
              inputMode="decimal"
              className="h-9 w-20 rounded-lg border border-line bg-raised px-2 text-sm tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="25"
              value={customText}
              onChange={(e) => {
                const t = e.target.value.replace(/[^\d.]/g, "");
                setCustomText(t);
                const n = Number(t);
                onChange(t && n > 0 && n <= 100 ? n : null);
              }}
            />
            <span className="text-sm text-ink-secondary">%</span>
          </span>
        )}
      </div>
      {opinion && (
        <p className="text-sm text-ink-secondary" aria-live="polite">
          {opinion}
        </p>
      )}
    </div>
  );
}
