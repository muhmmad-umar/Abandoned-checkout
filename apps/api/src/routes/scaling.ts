import type { FastifyInstance } from "fastify";
import { DAY_MS } from "@ad-scaler/shared";
import { loadCampaignContext } from "@ad-scaler/queue";
import { appliedCycles, buildOverrideHistory, buildOverrideOpinion, buildScalingProfile } from "@ad-scaler/scaling-engine";
import { HttpError, notFound, ownedCampaign, parse } from "../app";
import { insightResponseSchema, opinionSchema, scaleSchema } from "../schemas";
import type { ApiServices } from "../services";
import { campaignView, storedRec } from "../views";

const PREF_PCT = { conservative: { strong: 20, good: 10 }, moderate: { strong: 30, good: 20 }, aggressive: { strong: 40, good: 30 } } as const;

export const scalingRoutes = (s: ApiServices) => async (app: FastifyInstance) => {
  app.get<{ Params: { id: string } }>("/campaigns/:id/recommendation", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const v = await campaignView(s, req.params.id);
    return { recommendation: v.recommendation, earlyScale: v.earlyScale, goal: v.goal };
  });

  /** The one inline opinion shown before the client confirms a % that differs from ours. */
  app.post<{ Params: { id: string } }>("/campaigns/:id/recommendation/opinion", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const { clientPct } = parse(opinionSchema, req.body);
    const rec = await s.db.scalingRecommendation.findFirst({ where: { campaignId: req.params.id, status: "open" }, orderBy: { createdAt: "desc" } });
    if (!rec) throw notFound("No open recommendation");
    const { decision, metrics } = storedRec(rec);
    const ctx = await loadCampaignContext(s, req.params.id);
    const last = appliedCycles(ctx.cycles).at(-1);
    const daysOfData = last ? Math.max(1, Math.floor((s.now().getTime() - last.startedAt.getTime()) / DAY_MS)) : ctx.thresholds.lookbackDays;
    return {
      systemPct: decision.verdict.pct,
      clientPct,
      opinion: buildOverrideOpinion(decision.verdict, clientPct, metrics, ctx.brief, daysOfData),
    };
  });

  /** Apply the client's choice. Runs on the scaling queue; the response is the worker's result. */
  app.post<{ Params: { id: string } }>("/campaigns/:id/scale", async (req, reply) => {
    await ownedCampaign(s, req, req.params.id);
    const body = parse(scaleSchema, req.body);
    const rec = await s.db.scalingRecommendation.findFirst({ where: { id: body.recommendationId, campaignId: req.params.id } });
    if (!rec) throw notFound("Recommendation not found");
    const result = await s.jobs.execute({ ...body, userId: req.user.id });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "platform_error" ? 502 : 409;
      return reply.status(status).send({ error: result.code, message: result.message });
    }
    return result;
  });

  /** Scaling cycle log + override history. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/cycles", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const ctx = await loadCampaignContext(s, req.params.id);
    return {
      cycles: ctx.cycleRows.map((c) => ({
        id: c.id, cycleNumber: c.cycleNumber, status: c.status, startedAt: c.startedAt, cooldownEndsAt: c.cooldownEndsAt,
        budgetBefore: Number(c.budgetBefore), budgetAfter: Number(c.budgetAfter), pctChange: Number(c.pctChange),
        systemRecommendationPct: Number(c.systemRecommendationPct), clientChosenPct: Number(c.clientChosenPct),
        overrideFlag: c.overrideFlag, earlyTriggerFlag: c.earlyTriggerFlag, dayOfCooldownWhenTriggered: c.dayOfCooldownWhenTriggered,
        systemRationale: c.systemRationale, outcome: c.outcomeVsPrediction, systemNote: c.systemNote,
        ceilingDetected: c.ceilingDetected, ceilingReason: c.ceilingReason,
      })),
      overrideHistory: buildOverrideHistory(ctx.cycles),
    };
  });

  /** Immutable audit log. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/logs", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    return s.db.scalingLog.findMany({ where: { campaignId: req.params.id }, orderBy: { timestamp: "desc" }, take: 200 });
  });

  /** Risk appetite, override record, and (once) a pattern insight. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/profile", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const ctx = await loadCampaignContext(s, req.params.id);
    const stored = await s.db.clientScalingProfile.findUnique({ where: { campaignId: req.params.id } });
    const p = buildScalingProfile(ctx.cycles);
    const shown = (stored?.insightsShown as string[] | undefined) ?? [];
    return {
      ...p,
      riskAppetite: stored?.manuallyAdjusted ? stored.riskAppetite : p.riskAppetite,
      manuallyAdjusted: stored?.manuallyAdjusted ?? false,
      insight: p.insight && !shown.includes(p.insight.kind) ? p.insight : null,
    };
  });

  /** The client answers a pattern insight. Accepting a profile change updates their scale steps. */
  app.post<{ Params: { id: string; kind: string } }>("/campaigns/:id/profile/insights/:kind", async (req) => {
    const c = await ownedCampaign(s, req, req.params.id);
    const { accept } = parse(insightResponseSchema, req.body);
    const kind = req.params.kind;
    if (!["suggest_aggressive", "suggest_conservative", "follow_system"].includes(kind)) throw new HttpError(400, "Unknown insight", "invalid_insight");
    const stored = await s.db.clientScalingProfile.findUnique({ where: { campaignId: c.id } });
    if (!stored) throw notFound("No scaling profile yet");
    const shown = [...new Set([...((stored.insightsShown as string[]) ?? []), kind])];
    const appetite = kind === "suggest_aggressive" ? "aggressive" : kind === "suggest_conservative" ? "conservative" : null;
    await s.db.clientScalingProfile.update({
      where: { campaignId: c.id },
      data: { insightsShown: shown, ...(accept && appetite ? { riskAppetite: appetite, manuallyAdjusted: true } : {}) },
    });
    if (accept && appetite && c.briefId) {
      const brief = await s.db.campaignBrief.findUniqueOrThrow({ where: { id: c.briefId } });
      const t = brief.thresholds as Record<string, unknown>;
      await s.db.campaignBrief.update({ where: { id: brief.id }, data: { thresholds: { ...t, scalePctByTier: PREF_PCT[appetite] } } });
      await s.jobs.evaluateScaling(c.id);
    }
    return { ok: true, riskAppetite: accept && appetite ? appetite : stored.riskAppetite };
  });
};
