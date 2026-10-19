-- A recommendation can have several attempts (a failed platform call, then a retry).
-- Only one non-failed cycle may reference it.
DROP INDEX "scaling_cycles_recommendation_id_key";
CREATE INDEX "scaling_cycles_recommendation_id_idx" ON "scaling_cycles"("recommendation_id");
CREATE UNIQUE INDEX "scaling_cycles_recommendation_applied" ON "scaling_cycles"("recommendation_id") WHERE status <> 'failed';
