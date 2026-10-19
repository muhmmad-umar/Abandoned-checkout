import type { FastifyInstance } from "fastify";
import { notFound, ownedCampaign, parse } from "../app";
import { briefItemStatusSchema, tagAdSchema } from "../schemas";
import type { ApiServices } from "../services";

export const creativeRoutes = (s: ApiServices) => async (app: FastifyInstance) => {
  /** Creative leaderboard from the latest analysis. */
  app.get<{ Params: { id: string } }>("/campaigns/:id/creatives", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const run = await s.db.analysisRun.findFirst({ where: { campaignId: req.params.id, finishedAt: { not: null }, error: null }, orderBy: { startedAt: "desc" } });
    const ads = await s.db.ad.findMany({ where: { campaignId: req.params.id } });
    const scores = run ? await s.db.creativeScore.findMany({ where: { analysisRunId: run.id } }) : [];
    const byAd = new Map(scores.map((x) => [x.adId, x]));
    return {
      analyzedAt: run?.finishedAt ?? null,
      creatives: ads
        .map((a) => {
          const sc = byAd.get(a.platformAdId);
          return {
            id: a.id, platformAdId: a.platformAdId, name: a.name, status: a.status, thumbnailUrl: a.thumbnailUrl,
            format: a.format, lengthSec: a.lengthSec, angle: a.angle, visualStyle: a.visualStyle, tone: a.tone,
            score: sc?.score ?? null, trend: sc?.trend ?? null, fatigued: sc?.fatigueFlag ?? false, fatigueReason: sc?.fatigueReason ?? null,
            ctr: sc ? Number(sc.ctr) : null, roas: sc ? Number(sc.roas) : null, cpa: sc?.cpa == null ? null : Number(sc.cpa),
            hookRate: sc?.hookRate == null ? null : Number(sc.hookRate), frequency: sc ? Number(sc.frequency) : null,
          };
        })
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    };
  });

  /** Tag a creative's format, angle, visual style and tone. Tags drive pattern analysis. */
  app.patch<{ Params: { id: string } }>("/ads/:id", async (req) => {
    const data = parse(tagAdSchema, req.body);
    const ad = await s.db.ad.findFirst({ where: { id: req.params.id, campaign: { userId: req.user.id } } });
    if (!ad) throw notFound("Creative not found");
    return s.db.ad.update({ where: { id: ad.id }, data });
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id/creative-brief", async (req) => {
    await ownedCampaign(s, req, req.params.id);
    const brief = await s.db.creativeBrief.findFirst({
      where: { campaignId: req.params.id },
      orderBy: { generatedAt: "desc" },
      include: { items: { orderBy: { priority: "asc" } } },
    });
    if (!brief) throw notFound("No creative brief yet");
    return brief;
  });

  /** Brief item tracker: pending → brief sent → in production → uploaded → live. */
  app.patch<{ Params: { id: string } }>("/brief-items/:id", async (req) => {
    const { status } = parse(briefItemStatusSchema, req.body);
    const item = await s.db.briefItem.findFirst({ where: { id: req.params.id, creativeBrief: { campaign: { userId: req.user.id } } } });
    if (!item) throw notFound("Brief item not found");
    return s.db.briefItem.update({ where: { id: item.id }, data: { status } });
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/creative-analysis", async (req, reply) => {
    await ownedCampaign(s, req, req.params.id);
    await s.jobs.creativeAnalysis(req.params.id, "manual");
    return reply.status(202).send({ queued: true });
  });
};
