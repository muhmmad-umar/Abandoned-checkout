import { Worker } from "bullmq";
import { getPrisma } from "@ad-scaler/db";
import { MetaClient } from "@ad-scaler/meta-client";
import { emailChannel, inAppChannel, NotificationService, resendSender, slackChannel } from "@ad-scaler/notifications";
import { decryptSecret } from "@ad-scaler/shared";
import type { Deps } from "./deps";
import { creativeProcessor, scalingProcessor, syncProcessor } from "./processors";
import { bullEnqueuer, connectionFromUrl, createQueues, QUEUE } from "./queues";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

async function main() {
  const connection = connectionFromUrl(env("REDIS_URL"));
  const queues = createQueues(connection);
  const db = getPrisma();
  const key = env("TOKEN_ENCRYPTION_KEY");
  const channels = [
    inAppChannel((userId, m) => db.notification.create({ data: { userId, campaignId: m.campaignId, kind: m.kind, title: m.title, body: m.body, link: m.link } })),
    slackChannel(),
  ];
  if (process.env.RESEND_API_KEY) channels.push(emailChannel(await resendSender(process.env.RESEND_API_KEY, env("EMAIL_FROM"))));

  const deps: Deps = {
    db,
    platformFor: (account) => {
      if (account.platform !== "meta") throw new Error(`Platform ${account.platform} is not supported yet`);
      return new MetaClient(decryptSecret(account.accessToken, key), {
        version: process.env.META_API_VERSION,
        currencyOffset: ZERO_DECIMAL.has(account.currency) ? 1 : 100,
      });
    },
    notifications: new NotificationService(channels),
    enqueue: bullEnqueuer(queues),
    now: () => new Date(),
    appUrl: env("APP_URL"),
  };

  const workers = [
    new Worker(QUEUE.sync, syncProcessor(deps), { connection, concurrency: 5 }),
    new Worker(QUEUE.creative, creativeProcessor(deps), { connection, concurrency: 2 }),
    new Worker(QUEUE.scaling, scalingProcessor(deps), { connection, concurrency: 5 }),
  ];
  for (const w of workers) w.on("failed", (job, err) => console.error(`[${w.name}] ${job?.name} ${job?.id} failed:`, err.message));
  console.log("Workers running:", workers.map((w) => w.name).join(", "));

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await queues.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/** Currencies Meta bills without minor units. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "IDR", "COP", "CRC", "PYG"]);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
