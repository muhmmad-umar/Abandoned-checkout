import type { Tone } from "@/components/ui/status";
import type { CampaignStatus, ScalingState } from "./types";

/** One label per campaign, combining automation status and Phase 2 state. */
export function campaignStatus(status: CampaignStatus, state: ScalingState, hasBrief = true): { tone: Tone; label: string } {
  if (!hasBrief || status === "draft") return { tone: "neutral", label: "Needs Scaling Brief" };
  if (status === "paused") return { tone: "neutral", label: "Paused" };
  if (status === "monitoring") return { tone: "good", label: "Monitoring" };
  switch (state) {
    case "awaiting_client": return { tone: "accent", label: "Recommendation ready" };
    case "cooldown": return { tone: "accent", label: "Cooling down" };
    case "blocked": return { tone: "critical", label: "Scaling paused" };
    case "ceiling": return { tone: "serious", label: "Ceiling detected" };
    case "goal_reached": return { tone: "good", label: "Goal reached" };
    default: return { tone: "neutral", label: "Analyzing" };
  }
}

export const GOAL_TONE: Record<string, Tone> = {
  on_track: "good",
  slightly_behind: "warning",
  off_track: "critical",
  ceiling: "serious",
  goal_reached: "good",
};
