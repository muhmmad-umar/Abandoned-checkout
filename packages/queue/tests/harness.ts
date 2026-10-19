import { fromScalingBrief, getPrisma, type PrismaClient } from "@ad-scaler/db";
import type { MetaAd, MetaAdDaily, MetaBudgetTarget } from "@ad-scaler/meta-client";
import { inAppChannel, NotificationService } from "@ad-scaler/notifications";
import { deriveThresholds } from "@ad-scaler/scaling-engine";
import type { ScalingBrief } from "@ad-scaler/shared";
import type { AdPlatform, Deps, Enqueuer } from "../src";

/** Per-ad profile: share of spend, ROAS, and format. */
const PROFILES = [
  { id: "ad_u1", name: "UGC pain point", format: "video", share: 0.3, roas: 2.6, video: true },
  { id: "ad_u2", name: "UGC pain point 2", format: "video", share: 0.25, roas: 2.4, video: true },
  { id: "ad_v1", name: "Demo video", format: "video", share: 0.2, roas: 2.0, video: true },
  { id: "ad_s1", name: "Offer static", format: "static", share: 0.15, roas: 1.6, video: false },
  { id: "ad_s2", name: "Offer static 2", format: "static", share: 0.1, roas: 1.4, video: false },
] as const;

/** Fake Meta account whose spend follows the budget in effect each day. */
export class FakeMeta implements AdPlatform {
  budgets: { from: string; budget: number }[] = [{ from: "2000-01-01", budget: 1200 }];
  failNextBudgetWrite: string | null = null;
  budgetWrites: number[] = [];
  /** Multiplies ROAS on dates >= `from`. */
  roasShift: { from: string; factor: number } | null = null;

  constructor(private readonly clock: () => Date) {}

  budgetOn(date: string) {
    return [...this.budgets].reverse().find((b) => b.from <= date)!.budget;
  }

  async listAds(): Promise<MetaAd[]> {
    return PROFILES.map((p) => ({
      id: p.id, name: p.name, status: "ACTIVE", format: p.format, videoId: p.video ? `vid_${p.id}` : null,
      thumbnailUrl: null, createdAt: new Date(p.id === "ad_u2" ? "2026-01-08T00:00:00Z" : "2025-12-01T00:00:00Z"),
    }));
  }
  async getVideoLengths(ids: string[]) {
    return Object.fromEntries(ids.map((id) => [id, 12]));
  }
  async getAdDailyInsights(_c: string, since: string, until: string): Promise<MetaAdDaily[]> {
    const out: MetaAdDaily[] = [];
    for (let d = new Date(`${since}T00:00:00Z`); d.toISOString().slice(0, 10) <= until; d = new Date(d.getTime() + 86_400_000)) {
      const date = d.toISOString().slice(0, 10);
      const budget = this.budgetOn(date);
      const factor = this.roasShift && date >= this.roasShift.from ? this.roasShift.factor : 1;
      for (const p of PROFILES) {
        const spend = Math.round(budget * p.share * 100) / 100;
        const revenue = Math.round(spend * p.roas * factor * 100) / 100;
        const impressions = Math.round(spend * 100);
        out.push({
          adId: p.id, date, spend, impressions, clicks: Math.round(impressions * 0.015), frequency: 2,
          conversions: Math.round((revenue / 58.6) * 100) / 100, revenue,
          thumbStopRate: p.video ? 0.3 : null, videoCompletionRate: p.video ? 0.2 : null,
        });
      }
    }
    return out;
  }
  async getBudgetTarget(): Promise<MetaBudgetTarget> {
    return { level: "campaign", id: "cmp_1", dailyBudget: this.budgetOn(this.clock().toISOString().slice(0, 10)) };
  }
  async setDailyBudget(_id: string, budget: number) {
    if (this.failNextBudgetWrite) {
      const msg = this.failNextBudgetWrite;
      this.failNextBudgetWrite = null;
      throw new Error(msg);
    }
    this.budgetWrites.push(budget);
    // Takes effect from the next day's delivery.
    const next = new Date(this.clock().getTime() + 86_400_000).toISOString().slice(0, 10);
    this.budgets = this.budgets.filter((b) => b.from < next);
    this.budgets.push({ from: next, budget });
  }
}

export const testBrief = (): ScalingBrief => ({
  platform: "meta", currentDailyBudget: 1200, currentDailySpend: 1200, currentDailyConversions: 43, currentRoas: 2.16,
  currentCpa: 27.9, currentCtr: 0.015, avgOrderValue: 58.6, campaignAgeDays: 30, activeCreativeCount: 5,
  targetDailyConversions: 100, targetRoas: 2, targetCpa: 35, targetDailyBudget: 3000, targetTimelineWeeks: null,
  maxBudgetCap: 3000, minAcceptableRoas: 1.5, maxAcceptableCpa: 45, productMarginPct: 0.5, blackoutDates: [],
  scalePreference: "moderate", creativesInProduction: 0, creativeRefreshFrequency: "biweekly", formatsAvailable: ["static", "video", "ugc"],
});

export interface Harness {
  db: PrismaClient;
  deps: Deps;
  meta: FakeMeta;
  enqueued: { kind: string; campaignId: string; trigger?: string }[];
  setNow(iso: string): void;
  campaignId: string;
  userId: string;
}

/** Wipes the test database and seeds one user with one active Meta campaign and a submitted brief. */
export async function setup(): Promise<Harness> {
  const db = getPrisma();
  await db.$executeRawUnsafe(`TRUNCATE "users", "ad_accounts", "campaigns", "campaign_briefs", "scaling_logs", "scaling_cycles", "scaling_recommendations", "notifications" CASCADE`);
  let now = new Date("2026-01-15T12:00:00Z");
  const meta = new FakeMeta(() => now);
  const enqueued: Harness["enqueued"] = [];
  const enqueue: Enqueuer = {
    sync: async (campaignId) => void enqueued.push({ kind: "sync", campaignId }),
    creativeAnalysis: async (campaignId, trigger) => void enqueued.push({ kind: "creative", campaignId, trigger }),
    evaluateScaling: async (campaignId) => void enqueued.push({ kind: "evaluate", campaignId }),
  };
  const deps: Deps = {
    db,
    platformFor: () => meta,
    notifications: new NotificationService([
      inAppChannel((userId, m) => db.notification.create({ data: { userId, campaignId: m.campaignId, kind: m.kind, title: m.title, body: m.body, link: m.link } })),
    ]),
    enqueue,
    now: () => now,
    appUrl: "https://app.test",
  };

  const user = await db.user.create({ data: { clerkId: "user_test", email: "owner@brand.test", name: "Owner" } });
  const account = await db.adAccount.create({ data: { userId: user.id, platform: "meta", accountId: "act_1", name: "Brand", accessToken: "v1.x.y.z" } });
  const campaign = await db.campaign.create({
    data: { userId: user.id, adAccountId: account.id, platformCampaignId: "cmp_1", name: "Spring Sale", status: "active", launchedAt: new Date("2025-12-01T00:00:00Z") },
  });
  const b = testBrief();
  const brief = await db.campaignBrief.create({ data: { campaignId: campaign.id, userId: user.id, ...fromScalingBrief(b, deriveThresholds(b)), submittedAt: now } });
  await db.campaign.update({ where: { id: campaign.id }, data: { briefId: brief.id } });

  return { db, deps, meta, enqueued, campaignId: campaign.id, userId: user.id, setNow: (iso) => (now = new Date(iso)) };
}
