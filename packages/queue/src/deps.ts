import type { AdAccount, PrismaClient } from "@ad-scaler/db";
import type { MetaAd, MetaAdDaily, MetaBudgetTarget } from "@ad-scaler/meta-client";
import type { NotificationMessage, NotificationService } from "@ad-scaler/notifications";

/** The subset of MetaClient the workers use; tests substitute a fake. */
export interface AdPlatform {
  listAds(campaignId: string): Promise<MetaAd[]>;
  getVideoLengths(videoIds: string[]): Promise<Record<string, number>>;
  getAdDailyInsights(campaignId: string, since: string, until: string): Promise<MetaAdDaily[]>;
  getBudgetTarget(campaignId: string): Promise<MetaBudgetTarget>;
  setDailyBudget(entityId: string, dailyBudget: number): Promise<void>;
}

export type AnalysisTriggerName = "schedule" | "fatigue" | "manual" | "ceiling";

/** Follow-up jobs a processor can request. Implemented with BullMQ in production. */
export interface Enqueuer {
  sync(campaignId: string): Promise<void>;
  creativeAnalysis(campaignId: string, trigger: AnalysisTriggerName): Promise<void>;
  evaluateScaling(campaignId: string): Promise<void>;
}

export interface Deps {
  db: PrismaClient;
  platformFor(account: AdAccount): AdPlatform;
  notifications: NotificationService;
  enqueue: Enqueuer;
  now(): Date;
  appUrl: string;
}

/** Sends a notification to a user on all channels they have enabled. */
export async function notifyUser(deps: Deps, userId: string, message: NotificationMessage) {
  const user = await deps.db.user.findUniqueOrThrow({ where: { id: userId } });
  return deps.notifications.send(
    { userId, email: user.email, preferences: user.notificationPreferences as Record<string, never> },
    message,
  );
}

export const campaignLink = (deps: Deps, campaignId: string, tab?: string) =>
  `${deps.appUrl}/campaigns/${campaignId}${tab ? `?tab=${tab}` : ""}`;
