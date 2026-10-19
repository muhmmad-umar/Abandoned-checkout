import { clerkClient, clerkPlugin, getAuth } from "@clerk/fastify";
import { getPrisma } from "@ad-scaler/db";
import { exchangeCodeForLongLivedToken, MetaClient, type MetaAppConfig } from "@ad-scaler/meta-client";
import { bullEnqueuer, connectionFromUrl, createQueues, requestExecution, scheduleCampaign, unscheduleCampaign, type ExecuteResult } from "@ad-scaler/queue";
import { buildApp } from "./app";
import type { ApiServices } from "./services";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

async function main() {
  const queues = createQueues(connectionFromUrl(env("REDIS_URL")));
  const enqueue = bullEnqueuer(queues);
  const metaApp: MetaAppConfig = { appId: env("META_APP_ID"), appSecret: env("META_APP_SECRET"), redirectUri: env("META_REDIRECT_URI"), version: process.env.META_API_VERSION };

  const services: ApiServices = {
    db: getPrisma(),
    authenticate: async (req) => {
      const { userId } = getAuth(req);
      if (!userId) return null;
      const u = await clerkClient.users.getUser(userId);
      const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress;
      if (!email) return null;
      return { clerkId: userId, email, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null };
    },
    jobs: {
      schedule: (id, days) => scheduleCampaign(queues, id, days),
      unschedule: (id) => unscheduleCampaign(queues, id),
      sync: enqueue.sync,
      creativeAnalysis: enqueue.creativeAnalysis,
      evaluateScaling: enqueue.evaluateScaling,
      execute: (req) => requestExecution(queues, req) as Promise<ExecuteResult>,
    },
    meta: {
      app: metaApp,
      exchangeCode: (code) => exchangeCodeForLongLivedToken(metaApp, code),
      listAdAccounts: (token) => new MetaClient(token, { version: metaApp.version }).listAdAccounts(),
      listCampaigns: (token, acct) => new MetaClient(token, { version: metaApp.version }).listCampaigns(acct),
    },
    secrets: { tokenKey: env("TOKEN_ENCRYPTION_KEY"), oauthState: env("META_APP_SECRET") },
    appUrl: env("APP_URL"),
    now: () => new Date(),
  };

  // Clerk must be registered on the same instance that serves the routes.
  const app = await buildApp(services, { logger: true, beforeRoutes: (f) => f.register(clerkPlugin) });
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
