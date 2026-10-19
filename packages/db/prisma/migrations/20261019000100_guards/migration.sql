-- Database-level guarantees that application code must not be able to bypass.

-- 1. scaling_logs is append-only.
--    The only permitted UPDATE resolves a 'pending' entry to success/failed (with an error message).
CREATE FUNCTION scaling_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scaling_logs is append-only (attempted DELETE of %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.api_call_status <> 'pending' THEN
    RAISE EXCEPTION 'scaling_logs entry % is already resolved', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.campaign_id, NEW.cycle_id, NEW.action_type, NEW.old_value, NEW.new_value, NEW.triggered_by, NEW.timestamp)
     IS DISTINCT FROM
     (OLD.id, OLD.campaign_id, OLD.cycle_id, OLD.action_type, OLD.old_value, OLD.new_value, OLD.triggered_by, OLD.timestamp) THEN
    RAISE EXCEPTION 'scaling_logs entry % may only change api_call_status and error_message', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scaling_logs_append_only
  BEFORE UPDATE OR DELETE ON "scaling_logs"
  FOR EACH ROW EXECUTE FUNCTION scaling_logs_append_only();

-- 2. Cooldown is enforced on insert of a scaling cycle.
--    A new cycle is rejected while another is executing, or while the last applied cycle's
--    cooldown_ends_at is in the future, unless it is flagged as the client's early override.
--    An advisory lock per campaign serializes concurrent inserts.
CREATE FUNCTION scaling_cycles_enforce_cooldown() RETURNS trigger AS $$
DECLARE
  blocking RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('scaling_cycles:' || NEW.campaign_id));

  IF EXISTS (SELECT 1 FROM "scaling_cycles" WHERE campaign_id = NEW.campaign_id AND status = 'executing' AND id <> NEW.id) THEN
    RAISE EXCEPTION 'execution_in_progress: campaign % already has a budget change executing', NEW.campaign_id USING ERRCODE = 'P0001';
  END IF;

  SELECT id, cooldown_ends_at INTO blocking FROM "scaling_cycles"
   WHERE campaign_id = NEW.campaign_id AND status IN ('active', 'completed') AND cooldown_ends_at > NEW.started_at
   ORDER BY cooldown_ends_at DESC LIMIT 1;
  IF FOUND AND NOT NEW.early_trigger_flag THEN
    RAISE EXCEPTION 'cooldown_active: campaign % is in cooldown until %', NEW.campaign_id, blocking.cooldown_ends_at USING ERRCODE = 'P0001';
  END IF;

  IF NEW.cooldown_ends_at <= NEW.started_at THEN
    RAISE EXCEPTION 'cooldown_ends_at must be after started_at' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scaling_cycles_enforce_cooldown
  BEFORE INSERT ON "scaling_cycles"
  FOR EACH ROW EXECUTE FUNCTION scaling_cycles_enforce_cooldown();

-- Failed attempts keep their row for the audit trail but never take a cycle number.
CREATE UNIQUE INDEX "scaling_cycles_campaign_cycle_number_applied"
  ON "scaling_cycles" (campaign_id, cycle_number) WHERE status <> 'failed';

-- Budget sanity at rest.
ALTER TABLE "scaling_cycles" ADD CONSTRAINT "scaling_cycles_budget_positive" CHECK (budget_before > 0 AND budget_after > 0);
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_margin_range" CHECK (product_margin_pct > 0 AND product_margin_pct <= 1);
