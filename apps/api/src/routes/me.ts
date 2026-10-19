import type { FastifyInstance } from "fastify";
import { DEFAULT_ANGLES } from "@ad-scaler/creative-engine";
import { notFound, parse } from "../app";
import { angleTaxonomySchema, notificationPrefsSchema } from "../schemas";
import type { ApiServices } from "../services";

export const meRoutes = (s: ApiServices) => async (app: FastifyInstance) => {
  app.get("/me", async (req) => {
    const u = req.user;
    return {
      id: u.id, email: u.email, name: u.name, planTier: u.planTier,
      notificationPreferences: u.notificationPreferences,
      angleTaxonomy: u.angleTaxonomy.length ? u.angleTaxonomy : DEFAULT_ANGLES,
    };
  });

  app.patch("/me/notifications", async (req) => {
    const prefs = parse(notificationPrefsSchema, req.body);
    if (prefs.slack && !prefs.slackWebhookUrl) throw Object.assign(new Error("Add a Slack webhook URL to enable Slack alerts"), { statusCode: 400 });
    const u = await s.db.user.update({ where: { id: req.user.id }, data: { notificationPreferences: prefs } });
    return { notificationPreferences: u.notificationPreferences };
  });

  /** Clients can name their own angle taxonomy; an empty list restores the default. */
  app.put("/me/angle-taxonomy", async (req) => {
    const { angles } = parse(angleTaxonomySchema, req.body);
    const normalized = [...new Set(angles.map((a) => a.toLowerCase().replace(/[\s-]+/g, "_")))];
    const u = await s.db.user.update({ where: { id: req.user.id }, data: { angleTaxonomy: normalized } });
    return { angleTaxonomy: u.angleTaxonomy.length ? u.angleTaxonomy : DEFAULT_ANGLES };
  });

  app.get<{ Querystring: { unread?: string } }>("/notifications", async (req) => {
    const items = await s.db.notification.findMany({
      where: { userId: req.user.id, ...(req.query.unread === "true" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items, unread: await s.db.notification.count({ where: { userId: req.user.id, readAt: null } }) };
  });

  app.post<{ Params: { id: string } }>("/notifications/:id/read", async (req) => {
    const res = await s.db.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { readAt: s.now() } });
    if (res.count === 0) throw notFound();
    return { ok: true };
  });
};
