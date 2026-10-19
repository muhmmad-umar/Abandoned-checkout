import { z } from "zod";

const money = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** The Scaling Brief form. Percentages arrive as fractions (0.4 = 40%). */
export const scalingBriefSchema = z
  .object({
    currentDailyBudget: positive,
    currentDailySpend: money,
    currentDailyConversions: money,
    currentRoas: money,
    currentCpa: money,
    currentCtr: z.number().min(0).max(1),
    avgOrderValue: positive,
    campaignAgeDays: z.number().int().nonnegative(),
    activeCreativeCount: z.number().int().nonnegative(),
    targetDailyConversions: z.number().int().positive(),
    targetRoas: positive.nullable().default(null),
    targetCpa: positive.nullable().default(null),
    targetDailyBudget: positive.nullable().default(null),
    targetTimelineWeeks: z.number().int().positive().max(104).nullable().default(null),
    maxBudgetCap: positive,
    minAcceptableRoas: money,
    maxAcceptableCpa: positive,
    productMarginPct: z.number().gt(0).max(1),
    blackoutDates: z.array(isoDate).max(366).default([]),
    scalePreference: z.enum(["conservative", "moderate", "aggressive", "auto"]),
    creativesInProduction: z.number().int().nonnegative().default(0),
    creativeRefreshFrequency: z.enum(["weekly", "biweekly", "monthly", "adhoc"]),
    formatsAvailable: z.array(z.enum(["static", "video", "carousel", "ugc"])).min(1),
  })
  .superRefine((b, ctx) => {
    if (b.maxBudgetCap < b.currentDailyBudget) ctx.addIssue({ code: "custom", path: ["maxBudgetCap"], message: "Max budget cap must be at least your current daily budget" });
    if (b.targetDailyBudget != null && b.targetDailyBudget > b.maxBudgetCap) ctx.addIssue({ code: "custom", path: ["targetDailyBudget"], message: "Target budget can't exceed your max budget cap" });
    if (b.targetRoas != null && b.targetRoas < b.minAcceptableRoas) ctx.addIssue({ code: "custom", path: ["targetRoas"], message: "Target ROAS can't be below your minimum acceptable ROAS" });
    if (b.targetCpa != null && b.targetCpa > b.maxAcceptableCpa) ctx.addIssue({ code: "custom", path: ["targetCpa"], message: "Target CPA can't exceed your max acceptable CPA" });
  });

/** Client overrides of auto-set thresholds. */
export const thresholdOverridesSchema = z
  .object({
    cooldownDays: z.number().int().min(1).max(14),
    lookbackDays: z.number().int().min(3).max(7),
    creativeHealthBlockThreshold: z.number().int().min(0).max(100),
    creativeAnalysisIntervalDays: z.number().int().min(1).max(30),
    scalePctByTier: z.object({ strong: z.number().min(1).max(100), good: z.number().min(1).max(100) }),
  })
  .partial();

export const submitBriefSchema = z.object({ brief: scalingBriefSchema, thresholdOverrides: thresholdOverridesSchema.optional() });

export const scaleSchema = z.object({
  recommendationId: z.string().min(1),
  clientPct: z.number().finite().gt(0).max(100),
  earlyOverride: z.boolean().optional(),
  ceilingOverride: z.boolean().optional(),
});

export const opinionSchema = z.object({ clientPct: z.number().finite().gt(0).max(100) });

export const importCampaignSchema = z.object({ adAccountId: z.string().min(1), platformCampaignId: z.string().min(1), name: z.string().min(1).max(200) });

export const tagAdSchema = z
  .object({
    format: z.enum(["static", "video", "carousel", "ugc"]),
    angle: z.string().trim().min(1).max(60).nullable(),
    visualStyle: z.string().trim().min(1).max(60).nullable(),
    tone: z.string().trim().min(1).max(60).nullable(),
  })
  .partial();

export const briefItemStatusSchema = z.object({ status: z.enum(["pending", "brief_sent", "in_production", "uploaded", "live"]) });

export const goalChoiceSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("new_target"), targetDailyConversions: z.number().int().positive(), maxBudgetCap: positive.optional() }),
  z.object({ choice: z.literal("maintain") }),
  z.object({ choice: z.literal("pause") }),
]);

export const notificationPrefsSchema = z.object({
  email: z.boolean(),
  inApp: z.boolean(),
  slack: z.boolean(),
  slackWebhookUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://hooks.slack.com/"), "Must be a Slack incoming webhook URL")
    .nullable()
    .optional(),
});

export const angleTaxonomySchema = z.object({
  angles: z.array(z.string().trim().min(1).max(60).regex(/^[\w -]+$/)).max(30),
});

export const insightResponseSchema = z.object({ accept: z.boolean() });
