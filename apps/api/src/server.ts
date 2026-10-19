import { clerkClient, clerkPlugin, getAuth } from "@clerk/fastify";
import { getPrisma } from "@ad-scaler/db";
import { exchangeCodeForLongLivedToken, MetaClient, type MetaAppConfig } from "@ad-scaler/meta-client";
import { SimulatedPlatform, bullEnqueuer, connectionFromUrl, createQueues, requestExecution, scheduleCampaign, unscheduleCampaign, type ExecuteResult } from "@ad-scaler/queue";
import { buildApp } from "./app";
import type { ApiServices } from "./services";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

/** Local demo mode: a fixed user instead of Clerk. Refused in production. */
const devUser = process.env.DEV_AUTH_USER;
if (devUser && process.env.NODE_ENV === "production") throw new Error("DEV_AUTH_USER must not be set in production");

async function main() {
  const queues = createQueues(connectionFromUrl(env("REDIS_URL")));
  const enqueue = bullEnqueuer(queues);
  // Demo mode can run without a Meta app; connecting a real account still needs one.
  const metaEnv = (k: string) => (devUser ? (process.env[k] ?? "demo") : env(k));
  const metaApp: MetaAppConfig = { appId: metaEnv("META_APP_ID"), appSecret: metaEnv("META_APP_SECRET"), redirectUri: metaEnv("META_REDIRECT_URI"), version: process.env.META_API_VERSION };

  const services: ApiServices = {
    db: getPrisma(),
    authenticate: async (req) => {
      if (devUser) return { clerkId: devUser, email: "demo@adscaler.local", name: "Demo" };
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
      listCampaigns: (token, acct) =>
        devUser && acct.startsWith("demo_")
          ? new SimulatedPlatform(services.db, () => new Date()).listCampaigns()
          : new MetaClient(token, { version: metaApp.version }).listCampaigns(acct),
    },
    secrets: { tokenKey: env("TOKEN_ENCRYPTION_KEY"), oauthState: metaApp.appSecret },
    appUrl: env("APP_URL"),
    now: () => new Date(),
  };

  // Clerk must be registered on the same instance that serves the routes.
  const app = await buildApp(services, { logger: true, beforeRoutes: devUser ? undefined : (f) => f.register(clerkPlugin) });
  if (devUser) app.log.warn(`Demo mode: every request is treated as user "${devUser}"`);
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
