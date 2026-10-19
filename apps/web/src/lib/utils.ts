import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { fmtCount, fmtMoney, fmtPct, fmtRoas, plural } from "@ad-scaler/shared/format";

/** "3 days ago", "in 2 days", "just now" */
export function relativeTime(iso: string | Date, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [[86_400_000, "day"], [3_600_000, "hour"], [60_000, "minute"]];
  for (const [ms, unit] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const s = `${n} ${unit}${n === 1 ? "" : "s"}`;
      return diff < 0 ? `${s} ago` : `in ${s}`;
    }
  }
  return "just now";
}

export function shortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const humanize = (v: string) => {
  const s = v.replace(/[_-]+/g, " ").trim().replace(/\bugc\b/gi, "UGC");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
