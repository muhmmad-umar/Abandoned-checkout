import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-ink/5 text-ink-secondary",
      accent: "bg-accent-soft/60 text-accent-ink dark:bg-accent-soft/40",
      good: "bg-good-soft text-good-ink",
      warning: "bg-warning-soft text-warning-ink",
      serious: "bg-serious-soft text-serious-ink",
      critical: "bg-critical-soft text-critical-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...p} />
);
