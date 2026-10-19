import { plural } from "@ad-scaler/shared";

export type NotificationKind =
  | "creative_brief_ready"
  | "recommendation_ready"
  | "scaling_blocked"
  | "ceiling_detected"
  | "goal_reached"
  | "cycle_outcome"
  | "execution_failed"
  | "reconnect_required";

export interface NotificationMessage {
  kind: NotificationKind;
  campaignId?: string;
  title: string;
  body: string;
  link?: string;
}

/** Copy for every client-facing notification. Bodies always name the campaign and the client's numbers. */
export const templates = {
  creativeBriefReady: (c: { id: string; name: string }, needed: number, link: string): NotificationMessage => ({
    kind: "creative_brief_ready",
    campaignId: c.id,
    title: `${c.name}: creative brief ready`,
    body: `Your campaign ${c.name} needs ${plural(needed, "new creative")}. Your creative brief is ready. Review it here → ${link}`,
    link,
  }),
  recommendationReady: (c: { id: string; name: string }, headline: string, link: string): NotificationMessage => ({
    kind: "recommendation_ready",
    campaignId: c.id,
    title: `${c.name}: scaling recommendation ready`,
    body: `${headline} Review and choose here → ${link}`,
    link,
  }),
  scalingBlocked: (c: { id: string; name: string }, reason: string, link: string): NotificationMessage => ({
    kind: "scaling_blocked",
    campaignId: c.id,
    title: `${c.name}: scaling paused`,
    body: `${reason} → ${link}`,
    link,
  }),
  ceilingDetected: (c: { id: string; name: string }, reasons: string[], link: string): NotificationMessage => ({
    kind: "ceiling_detected",
    campaignId: c.id,
    title: `${c.name}: scaling ceiling reached`,
    body: `Campaign ${c.name} has reached its scaling ceiling. Further increases are likely to reduce performance. Recommended: refresh creatives before scaling again.${reasons.length ? `\n\n${reasons.map((r) => `• ${r}`).join("\n")}` : ""}\n\nWe've started a fresh creative analysis → ${link}`,
    link,
  }),
  goalReached: (c: { id: string; name: string }, target: number, link: string): NotificationMessage => ({
    kind: "goal_reached",
    campaignId: c.id,
    title: `${c.name}: goal reached 🏁`,
    body: `You've hit ${target} orders/day — your original target. What's next? Set a new target, switch to monitoring, or pause automation → ${link}`,
    link,
  }),
  cycleOutcome: (c: { id: string; name: string }, note: string, link: string): NotificationMessage => ({
    kind: "cycle_outcome",
    campaignId: c.id,
    title: `${c.name}: cooldown complete`,
    body: `${note} Your next scaling window is open → ${link}`,
    link,
  }),
  executionFailed: (c: { id: string; name: string }, error: string, link: string): NotificationMessage => ({
    kind: "execution_failed",
    campaignId: c.id,
    title: `${c.name}: budget change not applied`,
    body: `We couldn't apply your budget change: ${error}. Nothing was changed and your cycle was not advanced → ${link}`,
    link,
  }),
  reconnectRequired: (accountName: string, link: string): NotificationMessage => ({
    kind: "reconnect_required",
    title: "Reconnect your ad account",
    body: `Access to ${accountName} has expired. Reconnect it to keep syncing performance → ${link}`,
    link,
  }),
};
