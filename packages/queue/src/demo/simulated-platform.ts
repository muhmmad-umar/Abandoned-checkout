import type { PrismaClient } from "@ad-scaler/db";
import type { MetaAd, MetaAdDaily, MetaBudgetTarget, MetaCampaign } from "@ad-scaler/meta-client";
import type { AdPlatform } from "../deps";

/**
 * Local demo only. A deterministic stand-in for Meta, so the dashboard can be explored without
 * an ad account. Spend follows the budget history in the database; ROAS falls as budget grows
 * by the scenario's elasticity, so outcomes, fatigue and ceilings come from the real engines.
 */

interface AdProfile {
  id: string;
  name: string;
  format: "static" | "video" | "carousel";
  lengthSec?: number;
  share: number;
  roas: number;
  ctr: number;
  launchedDaysAgo: number;
  /** Frequency/CTR/ROAS decay per day over the simulation, for fatigue. */
  fatigue?: number;
}

export interface Scenario {
  name: string;
  startBudget: number;
  /** ROAS ∝ (budget / startBudget) ^ -elasticity */
  elasticity: number;
  ads: AdProfile[];
}

const ugcSet = (prefix: string, launchedDaysAgo = 9): AdProfile[] => [
  { id: `${prefix}_1`, name: "UGC — 'I tried everything'", format: "video", lengthSec: 12, share: 0.28, roas: 2.9, ctr: 0.021, launchedDaysAgo },
  { id: `${prefix}_2`, name: "UGC — Morning routine", format: "video", lengthSec: 14, share: 0.22, roas: 2.6, ctr: 0.019, launchedDaysAgo: 40 },
  { id: `${prefix}_3`, name: "Demo — How it works", format: "video", lengthSec: 38, share: 0.18, roas: 2.0, ctr: 0.014, launchedDaysAgo: 55 },
  { id: `${prefix}_4`, name: "Reviews carousel", format: "carousel", share: 0.14, roas: 2.2, ctr: 0.016, launchedDaysAgo: 50 },
  { id: `${prefix}_5`, name: "Static — 30% off", format: "static", share: 0.1, roas: 1.5, ctr: 0.011, launchedDaysAgo: 70 },
  { id: `${prefix}_6`, name: "Static — Feature list", format: "static", share: 0.08, roas: 1.3, ctr: 0.009, launchedDaysAgo: 70 },
];

export const SCENARIOS: Record<string, Scenario> = {
  demo_prospecting: { name: "Spring Sale — Prospecting", startBudget: 1000, elasticity: 0.06, ads: ugcSet("p") },
  demo_ugc: { name: "Evergreen UGC", startBudget: 800, elasticity: 0.08, ads: ugcSet("u", 6) },
  demo_retargeting: {
    name: "Retargeting — Cart abandoners",
    startBudget: 600,
    elasticity: 0.05,
    ads: ugcSet("r", 75).map((a, i) => ({ ...a, launchedDaysAgo: 75, fatigue: i < 4 ? 0.03 : 0 })),
  },
  demo_bundles: { name: "Bundles — Broad", startBudget: 1200, elasticity: 0.55, ads: ugcSet("b", 12) },
  demo_new: { name: "Summer Launch", startBudget: 500, elasticity: 0.1, ads: ugcSet("n") },
};

/** Stable pseudo-random in [-1, 1] from a string. */
function noise(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayMs = 86_400_000;

export class SimulatedPlatform implements AdPlatform {
  constructor(private readonly db: PrismaClient, private readonly now: () => Date) {}

  private scenario(platformCampaignId: string): Scenario {
    return SCENARIOS[platformCampaignId] ?? SCENARIOS.demo_new!;
  }

  private async campaign(platformCampaignId: string) {
    return this.db.campaign.findFirstOrThrow({ where: { platformCampaignId, adAccount: { accountId: { startsWith: "demo_" } } } });
  }

  /** Budget in effect on `date`: changes apply from the day after the cycle started. */
  private async budgetTimeline(platformCampaignId: string) {
    const s = this.scenario(platformCampaignId);
    const c = await this.campaign(platformCampaignId);
    const cycles = await this.db.scalingCycle.findMany({ where: { campaignId: c.id, status: { in: ["active", "completed"] } }, orderBy: { startedAt: "asc" } });
    return (date: string) => {
      let b = s.startBudget;
      for (const cy of cycles) if (iso(cy.startedAt) < date) b = Number(cy.budgetAfter);
      return b;
    };
  }

  async listCampaigns(): Promise<MetaCampaign[]> {
    return Object.entries(SCENARIOS).map(([id, s]) => ({ id, name: s.name, status: "ACTIVE", objective: "OUTCOME_SALES", dailyBudget: s.startBudget, startTime: null }));
  }

  async listAds(platformCampaignId: string): Promise<MetaAd[]> {
    return this.scenario(platformCampaignId).ads.map((a) => ({
      id: `${platformCampaignId}_${a.id}`, name: a.name, status: "ACTIVE", format: a.format,
      videoId: a.format === "video" ? `v_${a.id}` : null, thumbnailUrl: null,
      createdAt: new Date(this.now().getTime() - a.launchedDaysAgo * dayMs),
    }));
  }

  async getVideoLengths(ids: string[]): Promise<Record<string, number>> {
    const all = Object.values(SCENARIOS).flatMap((s) => s.ads);
    return Object.fromEntries(ids.map((id) => [id, all.find((a) => `v_${a.id}` === id)?.lengthSec ?? 20]));
  }

  async getAdDailyInsights(platformCampaignId: string, since: string, until: string): Promise<MetaAdDaily[]> {
    const s = this.scenario(platformCampaignId);
    const budgetOn = await this.budgetTimeline(platformCampaignId);
    const nowMs = this.now().getTime();
    // Fatigue is anchored to when the campaign was created, so a given day always has the same numbers.
    const simStart = (await this.campaign(platformCampaignId)).createdAt.getTime();
    const out: MetaAdDaily[] = [];
    for (let t = Date.parse(`${since}T00:00:00Z`); iso(new Date(t)) <= until; t += dayMs) {
      const date = iso(new Date(t));
      const budget = budgetOn(date);
      const elastic = (budget / s.startBudget) ** -s.elasticity;
      for (const a of s.ads) {
        const adId = `${platformCampaignId}_${a.id}`;
        const launched = nowMs - a.launchedDaysAgo * dayMs;
        if (t < launched - dayMs) continue;
        const age = Math.max(0, (t - simStart) / dayMs); // days into the simulation
        // Fatigue sets in ten days into the simulation and keeps deepening.
        const fade = a.fatigue ? Math.max(0.4, 1 - a.fatigue * Math.max(0, age - 10)) : 1;
        const n = (k: string) => 1 + 0.06 * noise(`${adId}:${date}:${k}`);
        const spend = Math.round(budget * a.share * n("s") * 100) / 100;
        const impressions = Math.round((spend / (11 * n("cpm") * (1 + (budget / s.startBudget - 1) * s.elasticity * 0.6))) * 1000);
        const ctr = a.ctr * fade * n("ctr");
        const clicks = Math.round(impressions * ctr);
        const revenue = Math.round(spend * a.roas * elastic * fade * n("r") * 100) / 100;
        const isVideo = a.format === "video";
        out.push({
          adId, date, spend, impressions, clicks,
          frequency: Math.round((1.6 + (a.fatigue ? Math.max(0, age - 10) * 0.12 : 0) + 0.2 * (budget / s.startBudget - 1)) * 100) / 100,
          conversions: Math.round((revenue / 62) * 100) / 100,
          revenue,
          thumbStopRate: isVideo ? Math.round(0.32 * fade * n("h") * 1000) / 1000 : null,
          videoCompletionRate: isVideo ? Math.round(((a.lengthSec ?? 20) < 15 ? 0.34 : 0.14) * n("c") * 1000) / 1000 : null,
        });
      }
    }
    return out;
  }

  async getBudgetTarget(platformCampaignId: string): Promise<MetaBudgetTarget> {
    const budgetOn = await this.budgetTimeline(platformCampaignId);
    // A change made today is live immediately on the platform, even though delivery shifts tomorrow.
    const c = await this.campaign(platformCampaignId);
    const latest = await this.db.scalingCycle.findFirst({ where: { campaignId: c.id, status: { in: ["active", "completed", "executing"] } }, orderBy: { startedAt: "desc" } });
    const today = iso(new Date(this.now().getTime() + dayMs));
    return { level: "campaign", id: platformCampaignId, dailyBudget: latest && latest.status !== "executing" ? Number(latest.budgetAfter) : budgetOn(today) };
  }

  async setDailyBudget(): Promise<void> {
    // The cycle row written by executeScaling is the budget history.
  }
}
