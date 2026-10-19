import { AlertTriangle, CheckCircle2, Flag, OctagonAlert, PauseCircle, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "accent";

const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good-ink",
  warning: "bg-warning-soft text-warning-ink",
  serious: "bg-serious-soft text-serious-ink",
  critical: "bg-critical-soft text-critical-ink",
  neutral: "bg-ink/5 text-ink-secondary",
  accent: "bg-accent-soft/60 text-accent-ink dark:bg-accent-soft/40",
};

const ICON = { good: CheckCircle2, warning: AlertTriangle, serious: AlertTriangle, critical: OctagonAlert, neutral: PauseCircle, accent: Timer };

/** Status is never color alone: always an icon and a label. */
export function StatusPill({ tone, label, className, icon }: { tone: Tone; label: string; className?: string; icon?: "flag" }) {
  const Icon = icon === "flag" ? Flag : ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONE[tone], className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** Health score band → tone. Matches the scaling health label bands. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 60) return "accent";
  if (score >= 40) return "warning";
  return "critical";
}
