import { Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectionFromUrl, createQueues, evaluateScaling, QUEUE, requestExecution, runCreativeAnalysis, scalingProcessor,
  scheduleCampaign, syncPerformance, unscheduleCampaign, type Queues,
} from "../src";
import { setup, type Harness } from "./harness";

const run = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

run("BullMQ wiring against Redis", () => {
  let h: Harness;
  let q: Queues;
  let worker: Worker;
  beforeAll(async () => {
    h = await setup();
    const connection = connectionFromUrl(process.env.REDIS_URL!);
    q = createQueues(connection);
    await Promise.all([q.sync.obliterate({ force: true }), q.creative.obliterate({ force: true }), q.scaling.obliterate({ force: true })]);
    worker = new Worker(QUEUE.scaling, scalingProcessor(h.deps), { connection });
  });
  afterAll(async () => {
    await worker?.close();
    await q?.close();
    await h?.db.$disconnect();
  });

  it("registers and removes per-campaign schedules", async () => {
    await scheduleCampaign(q, h.campaignId, 7);
    const ids = (await q.creative.getJobSchedulers()).map((s) => s.key);
    expect(ids).toContain(`creative:${h.campaignId}`);
    expect((await q.sync.getJobSchedulers()).map((s) => s.key)).toContain(`sync:${h.campaignId}`);
    await unscheduleCampaign(q, h.campaignId);
    expect(await q.creative.getJobSchedulers()).toHaveLength(0);
  });

  it("runs a client's budget change through the scaling queue and returns the result", async () => {
    await syncPerformance(h.deps, h.campaignId, 14);
    await runCreativeAnalysis(h.deps, h.campaignId, "manual");
    const ev = await evaluateScaling(h.deps, h.campaignId);
    const result = await requestExecution(q, { recommendationId: ev.recommendationId!, userId: h.userId, clientPct: 20 }, 20_000);
    expect(result).toMatchObject({ ok: true, cycleNumber: 1, budgetBefore: 1200, budgetAfter: 1440 });
    expect(h.meta.budgetWrites).toEqual([1440]);
  });
});
