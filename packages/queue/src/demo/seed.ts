/**
 * Seeds a local demo account by replaying 30 days through the real jobs with a simulated platform.
 * Dev databases only. Usage: npm run seed:demo [-- --reset]
 *
 * Ends with one campaign in each state: awaiting a decision, cooling down, blocked on
 * creative health, at a ceiling, and a fresh import that still needs its Scaling Brief.
 */
import { fromScalingBrief, getPrisma } from "@ad-scaler/db";
import { inAppChannel, NotificationService } from "@ad-scaler/notifications";
import { deriveThresholds } from "@ad-scaler/scaling-engine";
import { encryptSecret, type ScalingBrief } from "@ad-scaler/shared";
import { randomBytes } from "node:crypto";
import type { Deps } from "../deps";
import { runCreativeAnalysis } from "../jobs/creative";
import { evaluateScaling, executeScaling } from "../jobs/scaling";
import { syncPerformance } from "../jobs/sync";
import { SCENARIOS, SimulatedPlatform } from "./simulated-platform";

if (process.env.NODE_ENV === "production") throw new Error("The demo seed never runs in production.");

const DAY = 86_400_000;
const db = getPrisma();
const realNow = new Date();
let clock = new Date(realNow.getTime() - 30 * DAY);

/** What the scripted "client" does on given simulation days when a window is open. */
interface Script {
  key: keyof typeof SCENARIOS;
  brief: Partial<ScalingBrief>;
  applies: { day: number; pct: number; early?: boolean; ceiling?: boolean }[];
  tags: Record<string, { angle: string; visualStyle: string; tone: string; format?: "ugc" }>;
}

const TAGS = (p: string): Script["tags"] => ({
  [`${p}_1`]: { angle: "pain_point", visualStyle: "lifestyle", tone: "emotional", format: "ugc" },
  [`${p}_2`]: { angle: "social_proof", visualStyle: "lifestyle", tone: "emotional", format: "ugc" },
  [`${p}_3`]: { angle: "demo", visualStyle: "product_only", tone: "educational" },
  [`${p}_4`]: { angle: "testimonial", visualStyle: "minimal", tone: "direct_response" },
  [`${p}_5`]: { angle: "offer_led", visualStyle: "text_heavy", tone: "urgent" },
  [`${p}_6`]: { angle: "educational", visualStyle: "text_heavy", tone: "direct_response" },
});

const SCRIPTS: Script[] = [
  {
    key: "demo_prospecting",
    brief: { currentDailyBudget: 1000, currentDailyConversions: 37, targetDailyConversions: 100, maxBudgetCap: 3000, targetRoas: 2, targetCpa: 30, minAcceptableRoas: 1.5, maxAcceptableCpa: 40 },
    applies: [{ day: 3, pct: 20 }, { day: 8, pct: 30 }, { day: 13, pct: 20 }, { day: 18, pct: 20 }],
    tags: TAGS("p"),
  },
  {
    key: "demo_ugc",
    brief: { currentDailyBudget: 800, currentDailyConversions: 30, targetDailyConversions: 80, maxBudgetCap: 2400, targetRoas: 2, targetCpa: 30, minAcceptableRoas: 1.5, maxAcceptableCpa: 40 },
    applies: [{ day: 6, pct: 20 }, { day: 12, pct: 20 }, { day: 14, pct: 10, early: true }, { day: 28, pct: 20 }],
    tags: TAGS("u"),
  },
  {
    key: "demo_retargeting",
    brief: { currentDailyBudget: 600, currentDailyConversions: 22, targetDailyConversions: 50, maxBudgetCap: 1500, targetRoas: 2.2, targetCpa: 28, minAcceptableRoas: 1, maxAcceptableCpa: 60, creativeRefreshFrequency: "weekly" },
    applies: [{ day: 4, pct: 20 }],
    tags: TAGS("r"),
  },
  {
    key: "demo_bundles",
    brief: { currentDailyBudget: 1200, currentDailyConversions: 46, targetDailyConversions: 120, maxBudgetCap: 4000, targetRoas: 2, targetCpa: 30, minAcceptableRoas: 1.2, maxAcceptableCpa: 50, scalePreference: "aggressive" },
    applies: [{ day: 3, pct: 30 }, { day: 7, pct: 40 }, { day: 11, pct: 30 }, { day: 15, pct: 30 }],
    tags: TAGS("b"),
  },
];

function brief(over: Partial<ScalingBrief>): ScalingBrief {
  return {
    platform: "meta", currentDailyBudget: 1000, currentDailySpend: 990, currentDailyConversions: 35, currentRoas: 2.2, currentCpa: 28,
    currentCtr: 0.017, avgOrderValue: 62, campaignAgeDays: 30, activeCreativeCount: 6, targetDailyConversions: 100, targetRoas: null,
    targetCpa: null, targetDailyBudget: null, targetTimelineWeeks: null, maxBudgetCap: 3000, minAcceptableRoas: 1.5, maxAcceptableCpa: 40,
    productMarginPct: 0.55, blackoutDates: [], scalePreference: "moderate", creativesInProduction: 2, creativeRefreshFrequency: "biweekly",
    formatsAvailable: ["static", "video", "ugc", "carousel"], ...over,
  };
}

async function main() {
  const clerkId = process.env.DEV_AUTH_USER || "demo_user";
  const reset = process.argv.includes("--reset");
  if (await db.user.findUnique({ where: { clerkId } })) {
    if (!reset) {
      console.log(`Demo user ${clerkId} already exists. Re-run with --reset to wipe this database and reseed.`);
      return;
    }
  }
  if (reset) {
    const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }

  const platform = new SimulatedPlatform(db, () => clock);
  const deps: Deps = {
    db,
    platformFor: () => platform,
    notifications: new NotificationService([
      inAppChannel((userId, m) => db.notification.create({ data: { userId, campaignId: m.campaignId, kind: m.kind, title: m.title, body: m.body, link: m.link, createdAt: clock } })),
    ]),
    enqueue: { sync: async () => {}, creativeAnalysis: async () => {}, evaluateScaling: async () => {} },
    now: () => clock,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
  };

  const user = await db.user.create({ data: { clerkId, email: "demo@adscaler.local", name: "Demo" } });
  const account = await db.adAccount.create({
    data: { userId: user.id, platform: "meta", accountId: "demo_act_1", name: "Demo Brand (simulated)", accessToken: encryptSecret("demo", randomBytes(32).toString("base64")) },
  });

  const campaigns: { script: Script; id: string }[] = [];
  for (const script of SCRIPTS) {
    const s = SCENARIOS[script.key]!;
    const c = await db.campaign.create({
      data: { userId: user.id, adAccountId: account.id, platformCampaignId: script.key, name: s.name, status: "active", launchedAt: new Date(realNow.getTime() - 75 * DAY), createdAt: clock },
    });
    const b = brief(script.brief);
    const row = await db.campaignBrief.create({ data: { campaignId: c.id, userId: user.id, ...fromScalingBrief(b, deriveThresholds(b)), submittedAt: clock } });
    const { buildRoadmap } = await import("@ad-scaler/scaling-engine");
    const r = buildRoadmap(b);
    await db.scalingRoadmap.create({
      data: { campaignId: c.id, briefId: row.id, generatedAt: clock, projectedCycles: JSON.parse(JSON.stringify(r.cycles)), estimatedWeeks: r.estimatedWeeks, estimatedCreativesNeeded: r.estimatedCreativesNeeded.max, assumptions: JSON.parse(JSON.stringify(r.assumptions)) },
    });
    await db.campaign.update({ where: { id: c.id }, data: { briefId: row.id } });
    await syncPerformance(deps, c.id, 14);
    for (const [adSuffix, tag] of Object.entries(script.tags)) {
      await db.ad.updateMany({ where: { campaignId: c.id, platformAdId: `${script.key}_${adSuffix}` }, data: tag });
    }
    campaigns.push({ script, id: c.id });
  }
  // A fresh import with no brief yet.
  await db.campaign.create({ data: { userId: user.id, adAccountId: account.id, platformCampaignId: "demo_new", name: SCENARIOS.demo_new!.name } });

  for (let day = 0; day <= 30; day++) {
    clock = day === 30 ? realNow : new Date(realNow.getTime() - (30 - day) * DAY);
    for (const { script, id } of campaigns) {
      await syncPerformance(deps, id, day === 0 ? 1 : 2);
      if (day % 7 === 0 || day === 30) await runCreativeAnalysis(deps, id, day === 0 ? "manual" : "schedule");
      const ev = await evaluateScaling(deps, id);
      const plan = script.applies.find((a) => a.day === day);
      if (plan && ev.recommendationId) {
        const res = await executeScaling(deps, { recommendationId: ev.recommendationId, userId: user.id, clientPct: plan.pct, earlyOverride: plan.early, ceilingOverride: plan.ceiling });
        if (!res.ok) console.log(`  day ${day} ${script.key}: ${res.code} — ${res.message}`);
      }
    }
  }

  for (const { script, id } of campaigns) {
    const c = await db.campaign.findUniqueOrThrow({ where: { id } });
    console.log(`${script.key.padEnd(18)} ${c.scalingState.padEnd(16)} $${Number(c.currentDailyBudget)}/day`);
  }
  console.log(`\nSeeded demo user "${clerkId}". Start the API and web app with DEV_AUTH_USER=${clerkId}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
