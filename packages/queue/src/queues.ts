import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import type { AnalysisTriggerName, Enqueuer } from "./deps";
import type { ExecuteRequest } from "./jobs/scaling";

/** Separate queues so slow creative analysis never delays a client's budget change. */
export const QUEUE = { sync: "performance-sync", creative: "creative", scaling: "scaling" } as const;
export const JOB = {
  sync: "sync-performance",
  creative: "creative-analysis",
  evaluate: "evaluate-scaling",
  execute: "execute-scaling",
} as const;

export const SCHEDULE = {
  syncEveryMs: 2 * 60 * 60_000,
  scalingEvaluateEveryMs: 6 * 60 * 60_000,
};

export function connectionFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number(u.pathname.replace(/^\//, "")) || 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export interface Queues {
  sync: Queue;
  creative: Queue;
  scaling: Queue;
  scalingEvents: QueueEvents;
  close(): Promise<void>;
}

export function createQueues(connection: ConnectionOptions): Queues {
  const defaultJobOptions = { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 };
  const sync = new Queue(QUEUE.sync, { connection, defaultJobOptions });
  const creative = new Queue(QUEUE.creative, { connection, defaultJobOptions });
  const scaling = new Queue(QUEUE.scaling, { connection, defaultJobOptions });
  const scalingEvents = new QueueEvents(QUEUE.scaling, { connection });
  return {
    sync, creative, scaling, scalingEvents,
    close: async () => void (await Promise.all([sync.close(), creative.close(), scaling.close(), scalingEvents.close()])),
  };
}

/**
 * BullMQ-backed Enqueuer. Job ids dedupe bursts of identical requests.
 * Ids use "-" separators: BullMQ rejects custom ids containing ":" (reserved for its own keys).
 */
export function bullEnqueuer(q: Queues): Enqueuer {
  return {
    sync: async (campaignId) => void (await q.sync.add(JOB.sync, { campaignId }, { jobId: `sync-${campaignId}-${Math.floor(Date.now() / 60_000)}` })),
    creativeAnalysis: async (campaignId, trigger: AnalysisTriggerName) =>
      void (await q.creative.add(JOB.creative, { campaignId, trigger }, { jobId: `creative-${campaignId}-${trigger}-${Math.floor(Date.now() / 600_000)}` })),
    evaluateScaling: async (campaignId) =>
      void (await q.scaling.add(JOB.evaluate, { campaignId }, { jobId: `evaluate-${campaignId}-${Math.floor(Date.now() / 60_000)}` })),
  };
}

/**
 * Registers the recurring jobs for a campaign once its brief is submitted:
 * performance sync every 2h, Phase 1 on the brief's analysis interval, Phase 2 evaluation every 6h.
 */
export async function scheduleCampaign(q: Queues, campaignId: string, creativeIntervalDays: number) {
  await q.sync.upsertJobScheduler(`sync:${campaignId}`, { every: SCHEDULE.syncEveryMs }, { name: JOB.sync, data: { campaignId } });
  await q.creative.upsertJobScheduler(`creative:${campaignId}`, { every: creativeIntervalDays * 86_400_000 }, { name: JOB.creative, data: { campaignId, trigger: "schedule" } });
  await q.scaling.upsertJobScheduler(`evaluate:${campaignId}`, { every: SCHEDULE.scalingEvaluateEveryMs }, { name: JOB.evaluate, data: { campaignId } });
}

export async function unscheduleCampaign(q: Queues, campaignId: string) {
  await q.sync.removeJobScheduler(`sync:${campaignId}`);
  await q.creative.removeJobScheduler(`creative:${campaignId}`);
  await q.scaling.removeJobScheduler(`evaluate:${campaignId}`);
}

/** Queues a client's budget change and waits for the worker's result. Never retried automatically. */
export async function requestExecution(q: Queues, req: ExecuteRequest, timeoutMs = 60_000) {
  const job = await q.scaling.add(JOB.execute, req, { attempts: 1, jobId: `execute-${req.recommendationId}-${Date.now()}` });
  return job.waitUntilFinished(q.scalingEvents, timeoutMs);
}
