import type { FastifyInstance } from "fastify";
import { fromScalingBrief, type Prisma } from "@ad-scaler/db";
import { loadCampaignContext } from "@ad-scaler/queue";
import { aggregateWindow, buildRoadmap, scalingHealthLabel, SCALING_HEALTH_LABELS } from "@ad-scaler/scaling-engine";
import type { ScalingBrief, Thresholds } from "@ad-scaler/shared";
import { HttpError, notFound, ownedCampaign, parse } from "../app";
import { goalChoiceSchema, importCampaignSchema, submitBriefSchema } from "../schemas";
import type { ApiServices } from "../services";
import { campaignView, thresholdsFor } from "../views";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export const campaignRoutes = (s: ApiServices) => async (app: FastifyInstance) => {
  /** Saves a brief, its thresholds and roadmap, then starts automation. */
  async function activate(campaignId: string, userId: string, brief: ScalingBrief, thresholds: Thresholds) {
    const roadmap = buildRoadmap(brief, thresholds);
    await s.db.$transaction(async (tx) => {
      const b = await tx.campaignBrief.create({ data: { campaignId, userId, ...fromScalingBrief(brief, thresholds), submittedAt: s.now() } });
      await tx.scalingRoadmap.create({
        data: {
          campaignId, briefId: b.id, generatedAt: s.now(), projectedCycles: json(roadmap.cycles), estimatedWeeks: roadmap.estimatedWeeks,
          estimatedCreativesNeeded: roadmap.estimatedCreativesNeeded.max, assumptions: json({ ...roadmap.assumptions, notes: roadmap.notes, range: roadmap.estimatedCreativesNeeded }),
        },
      });
      await tx.campaign.update({ where: { id: campaignId }, data: { briefId: b.id, status: "active", scalingState: "idle" } });
      await tx.scalingRecommendation.updateMany({ where: { campaignId, status: "open" }, data: { status: "superseded", resolvedAt: s.now() } });
    });
    await s.jobs.schedule(campaignId, thresholds.creativeAnalysisIntervalDays);
    await s.jobs.sync(campaignId);
    await s.jobs.creativeAnalysis(campaignId, "manual");
    return roadmap;
  }

  app.post("/campaigns", async (req, reply) => {
    const body = parse(importCampaignSchema, req.body);
    const acct = await s.db.adAccount.findFirst({ where: { id: body.adAccountId, userId: req.user.id } });
    if (!acct) throw notFound("Ad account not found");
    const existing = await s.db.campaign.findUnique({ where: { adAccountId_platformCampaignId: { adAccountId: acct.id, platformCampaignId: body.platformCampaignId } } });
    if (existing) return reply.status(200).send(existing);
    const c = await s.db.campaign.create({ data: { userId: req.user.id, adAccountId: acct.id, platformCampaignId: body.platformCampaignId, name: body.name } });
    await s.jobs.sync(c.id);
    return reply.status(201).send(c);
  });

  /** Campaign list with health scores and status. */
  app.get("/campaigns", async (req) => {
    const campaigns = await s.db.campaign.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" } });
    return Promise.all(
      campaigns.map(async (c) => {
        const [creative, rec] = await Promise.all([
          s.db.creativeBrief.findFirst({ where: { campaignId: c.id }, orderBy: { generatedAt: "desc" }, select: { creativeHealthScore: true, creativesNeeded: true } }),
          s.db.scalingRecommendation.findFirst({ where: { campaignId: c.id }, orderBy: { createdAt: "desc" }, select: { healthScore: true } }),
        ]);
        return {
          id: c.id, name: c.name, status: c.status, scalingState: c.scalingState,
          currentDailyBudget: c.currentDailyBudget == null ? null : Number(c.currentDailyBudget),
          hasBrief: !!c.briefId,
          creativeHealthScore: creative?.creativeHealthScore ?? null,
          creativesNeeded: creative?.creativesNeeded ?? null,
          scalingHealthScore: rec?.healthScore ?? null,
          scalingHealthLabel: rec ? SCALING_HEALTH_LABELS[scalingHealthLabel(rec.healthScore)] : null,
        };
      }),
    );
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req) => {
    const c = await ownedCampaign(s, req, req.params.id);
    if (!c.briefId) return { campaign: c, needsBrief: true };
    return campaignView(s, c.id);
  });

  /** Live roadmap preview while the client fills in the brief. Saves nothing. */
  app.post<{ Params: { id: string } }>("/campaigns/:id/roadmap/preview", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const { brief, thresholdOverrides } = parse(submitBriefSchema, req.body);
    const sb: ScalingBrief = { ...brief, platform: "meta" };
    const thresholds = thresholdsFor(sb, thresholdOverrides);
    return { roadmap: buildRoadmap(sb, thresholds), thresholds };
  });

  /** Submit the Scaling Brief. Nothing automated runs before this. */
  app.post<{ Params: { id: string } }>("/campaigns/:id/brief", async (req, reply) => {
    const c = await ownedCampaign(s, req, req.params.id);
    const acct = await s.db.adAccount.findUniqueOrThrow({ where: { id: c.adAccountId } });
    const { brief, thresholdOverrides } = parse(submitBriefSchema, req.body);
    const sb: ScalingBrief = { ...brief, platform: acct.platform };
    const thresholds = thresholdsFor(sb, thresholdOverrides);
    const roadmap = await activate(c.id, req.user.id, sb, thresholds);
    return reply.status(201).send({ roadmap, thresholds });
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/roadmap", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const r = await s.db.scalingRoadmap.findFirst({ where: { campaignId: req.params.id }, orderBy: { generatedAt: "desc" } });
    if (!r) throw notFound("No roadmap yet — submit a Scaling Brief first");
    return r;
  });

  /** After the goal is reached: set a higher target, monitor, or pause. */
  app.post<{ Params: { id: string } }>("/campaigns/:id/goal", async (req) => {
    const c = await ownedCampaign(s, req, req.params.id);
    if (!c.briefId) throw new HttpError(409, "Submit a Scaling Brief first", "no_brief");
    const body = parse(goalChoiceSchema, req.body);

    if (body.choice === "pause") {
      await s.db.campaign.update({ where: { id: c.id }, data: { status: "paused" } });
      await s.jobs.unschedule(c.id);
      return { status: "paused", message: "Automation paused. Your budget stays where it is." };
    }
    if (body.choice === "maintain") {
      await s.db.campaign.update({ where: { id: c.id }, data: { status: "monitoring" } });
      return { status: "monitoring", message: "Switched to monitoring mode. We'll keep watching and alert you if performance slips, without recommending new increases." };
    }

    // New target: regenerate the roadmap from today's baseline.
    const ctx = await loadCampaignContext(s, c.id);
    if (!ctx.daily.length) throw new HttpError(409, "No performance data yet", "no_data");
    const m = aggregateWindow(ctx.daily, ctx.thresholds.lookbackDays);
    const maxBudgetCap = body.maxBudgetCap ?? ctx.brief.maxBudgetCap;
    const budget = ctx.currentDailyBudget ?? ctx.brief.currentDailyBudget;
    if (maxBudgetCap < budget) throw new HttpError(400, "Max budget cap must be at least your current daily budget", "invalid_cap");
    const next: ScalingBrief = {
      ...ctx.brief,
      currentDailyBudget: budget,
      currentDailySpend: m.dailySpend,
      currentDailyConversions: m.dailyConversions,
      currentRoas: m.roas,
      currentCpa: m.cpa ?? ctx.brief.currentCpa,
      currentCtr: m.ctr,
      campaignAgeDays: ctx.campaignAgeDays,
      targetDailyConversions: body.targetDailyConversions,
      targetDailyBudget: null,
      maxBudgetCap,
    };
    // Targets are recalculated from the new baseline; the client's own rule overrides carry over.
    const prev = ctx.thresholds;
    const thresholds = thresholdsFor(next, {
      cooldownDays: prev.cooldownDays,
      lookbackDays: prev.lookbackDays,
      creativeHealthBlockThreshold: prev.creativeHealthBlockThreshold,
      creativeAnalysisIntervalDays: prev.creativeAnalysisIntervalDays,
      scalePctByTier: prev.scalePctByTier,
    });
    const roadmap = await activate(c.id, req.user.id, next, thresholds);
    return { status: "active", roadmap };
  });
};
