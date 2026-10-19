import type { Job } from "bullmq";
import type { AnalysisTriggerName, Deps } from "./deps";
import { runCreativeAnalysis } from "./jobs/creative";
import { evaluateScaling, executeScaling, type ExecuteRequest } from "./jobs/scaling";
import { syncPerformance } from "./jobs/sync";
import { JOB } from "./queues";

export const syncProcessor = (deps: Deps) => async (job: Job<{ campaignId: string }>) => {
  const res = await syncPerformance(deps, job.data.campaignId);
  // Fresh numbers may change the recommendation.
  await deps.enqueue.evaluateScaling(job.data.campaignId);
  return res;
};

export const creativeProcessor = (deps: Deps) => (job: Job<{ campaignId: string; trigger: AnalysisTriggerName }>) =>
  runCreativeAnalysis(deps, job.data.campaignId, job.data.trigger);

export const scalingProcessor = (deps: Deps) => (job: Job) => {
  if (job.name === JOB.execute) return executeScaling(deps, job.data as ExecuteRequest);
  return evaluateScaling(deps, (job.data as { campaignId: string }).campaignId);
};
