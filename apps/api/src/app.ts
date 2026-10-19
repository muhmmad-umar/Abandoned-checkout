import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { ApiServices } from "./services";
import { campaignRoutes } from "./routes/campaigns";
import { creativeRoutes } from "./routes/creatives";
import { metaRoutes } from "./routes/meta";
import { meRoutes } from "./routes/me";
import { scalingRoutes } from "./routes/scaling";

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string, readonly code?: string) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

/** Routes that skip authentication (the OAuth callback carries a signed state instead). */
const PUBLIC = new Set(["/health", "/meta/callback"]);

export interface BuildOptions {
  logger?: boolean;
  corsOrigin?: string;
  /** Plugins that must wrap every route, e.g. Clerk. */
  beforeRoutes?: (app: FastifyInstance) => unknown;
}

export async function buildApp(s: ApiServices, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: opts.corsOrigin ?? s.appUrl, credentials: true });
  if (opts.beforeRoutes) await opts.beforeRoutes(app);

  app.decorateRequest("user", null as never);
  app.addHook("preHandler", async (req: FastifyRequest) => {
    const path = req.routeOptions.url ?? req.url;
    if (PUBLIC.has(path)) return;
    const id = await s.authenticate(req);
    if (!id) throw new HttpError(401, "Sign in required", "unauthenticated");
    req.user = await s.db.user.upsert({
      where: { clerkId: id.clerkId },
      update: {},
      create: { clerkId: id.clerkId, email: id.email, name: id.name ?? null },
    });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "invalid_request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.code ?? "error", message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? "error", message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Something went wrong" });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(meRoutes(s));
  await app.register(metaRoutes(s));
  await app.register(campaignRoutes(s));
  await app.register(scalingRoutes(s));
  await app.register(creativeRoutes(s));
  return app;
}

/** Loads a campaign owned by the requesting user, or 404s (never reveals other tenants' ids). */
export async function ownedCampaign(s: ApiServices, req: FastifyRequest, id: string) {
  const c = await s.db.campaign.findFirst({ where: { id, userId: req.user.id } });
  if (!c) throw notFound("Campaign not found");
  return c;
}
