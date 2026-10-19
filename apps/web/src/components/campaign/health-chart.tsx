"use client";

import { Table2, LineChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/utils";

const BANDS = [
  { min: 80, label: "Scaling freely" },
  { min: 60, label: "Healthy" },
  { min: 40, label: "Caution" },
  { min: 0, label: "Ceiling" },
];
const bandOf = (v: number) => BANDS.find((b) => v >= b.min)!.label;

/** One point per day (the day's last evaluation). */
function daily(points: { at: string; score: number }[]) {
  const byDay = new Map<string, { at: string; score: number }>();
  for (const p of points) byDay.set(p.at.slice(0, 10), p);
  return [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at));
}

const M = { top: 12, right: 12, bottom: 28, left: 32 };
const PLOT_H = 180;

/**
 * Scaling health score over time. Single series: no legend; the title names it.
 * Hairline gridlines mark the band edges (40/60/80); a crosshair snaps to the nearest day.
 */
export function HealthChart({ points, title = "Scaling health" }: { points: { at: string; score: number }[]; title?: string }) {
  const data = useMemo(() => daily(points), [points]);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showBands = width >= 460;
  const right = showBands ? 96 : M.right;
  const plotW = Math.max(0, width - M.left - right);
  const x = (i: number) => M.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => M.top + PLOT_H - (v / 100) * PLOT_H;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.score).toFixed(1)}`).join("");
  const area = data.length > 1 ? `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const tickIdx = data.length <= 1 ? [0] : [...new Set([0, Math.round((data.length - 1) / 3), Math.round((2 * (data.length - 1)) / 3), data.length - 1])];
  const last = data[data.length - 1];

  const onMove = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || data.length === 0) return;
    const px = clientX - box.left - M.left;
    const i = data.length <= 1 ? 0 : Math.round((px / plotW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover == null ? null : data[hover];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {data.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? <LineChart className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
            {table ? "Chart" : "Table"}
          </Button>
        )}
      </div>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-secondary">The trend appears after the first scaling evaluation.</p>
      ) : table ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-ink-muted">
              <tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Score</th><th className="px-3 py-2 font-medium">Band</th></tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {[...data].reverse().map((d) => (
                <tr key={d.at}><td className="px-3 py-1.5">{shortDate(d.at)}</td><td className="px-3 py-1.5 text-right">{d.score}</td><td className="px-3 py-1.5 text-ink-secondary">{bandOf(d.score)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative select-none outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
          style={{ height: M.top + PLOT_H + M.bottom }}
          tabIndex={0}
          role="img"
          aria-label={`${title}: ${last ? `latest ${last.score} of 100 (${bandOf(last.score)})` : "no data"}. Use arrow keys to read each day, or switch to the table.`}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setHover((cur) => Math.max(0, Math.min(data.length - 1, (cur ?? data.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
            }
          }}
          onBlur={() => setHover(null)}
        >
          {width > 0 && (
            <svg width={width} height={M.top + PLOT_H + M.bottom} className="block overflow-visible" aria-hidden>
              {[0, 40, 60, 80, 100].map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular">{v}</text>
                </g>
              ))}
              {showBands &&
                BANDS.map((b, i) => {
                  const top = i === 0 ? 100 : BANDS[i - 1]!.min;
                  return (
                    <text key={b.label} x={M.left + plotW + 10} y={y((top + b.min) / 2)} dy="0.32em" className="fill-ink-muted text-[11px]">{b.label}</text>
                  );
                })}
              {area && <path d={area} fill="var(--chart-series)" fillOpacity={0.1} />}
              {data.length > 1 && <path d={line} fill="none" stroke="var(--chart-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {tickIdx.map((i) => (
                <text key={i} x={x(i)} y={M.top + PLOT_H + 18} textAnchor={data.length > 1 && i === 0 ? "start" : data.length > 1 && i === data.length - 1 ? "end" : "middle"} className="fill-ink-muted text-[11px]">
                  {shortDate(data[i]!.at)}
                </text>
              ))}
              {h && hover != null && (
                <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />
              )}
              {last && (
                <>
                  <circle cx={x(data.length - 1)} cy={y(last.score)} r={6} fill="rgb(var(--surface))" />
                  <circle cx={x(data.length - 1)} cy={y(last.score)} r={4} fill="var(--chart-series)" />
                  {hover == null && (
                    <text x={x(data.length - 1) - 8} y={y(last.score) - 10} textAnchor="end" className="fill-ink text-xs font-semibold tabular">{last.score}</text>
                  )}
                </>
              )}
              {h && hover != null && hover !== data.length - 1 && (
                <>
                  <circle cx={x(hover)} cy={y(h.score)} r={6} fill="rgb(var(--surface))" />
                  <circle cx={x(hover)} cy={y(h.score)} r={4} fill="var(--chart-series)" />
                </>
              )}
            </svg>
          )}
          {h && hover != null && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-sm"
              style={{ left: Math.min(Math.max(x(hover) - 60, 0), width - 132), top: 0, width: 132 }}
              role="status"
            >
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full bg-[var(--chart-series)]" aria-hidden />
                <span className="text-sm font-semibold tabular">{h.score}</span>
                <span className="text-ink-muted">/ 100</span>
              </div>
              <div className="mt-0.5 text-ink-secondary">{shortDate(h.at)} · {bandOf(h.score)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
