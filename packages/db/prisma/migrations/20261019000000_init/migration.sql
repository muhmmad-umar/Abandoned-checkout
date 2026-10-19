-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('meta', 'google', 'tiktok');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'starter', 'growth', 'agency');

-- CreateEnum
CREATE TYPE "ScalePreference" AS ENUM ('conservative', 'moderate', 'aggressive', 'auto');

-- CreateEnum
CREATE TYPE "RefreshFrequency" AS ENUM ('weekly', 'biweekly', 'monthly', 'adhoc');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'monitoring', 'paused');

-- CreateEnum
CREATE TYPE "ScalingState" AS ENUM ('idle', 'awaiting_client', 'cooldown', 'blocked', 'ceiling', 'goal_reached');

-- CreateEnum
CREATE TYPE "CreativeTrend" AS ENUM ('improving', 'stable', 'declining');

-- CreateEnum
CREATE TYPE "BriefItemStatus" AS ENUM ('pending', 'brief_sent', 'in_production', 'uploaded', 'live');

-- CreateEnum
CREATE TYPE "AnalysisTrigger" AS ENUM ('schedule', 'fatigue', 'manual', 'ceiling');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('executing', 'active', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CycleOutcome" AS ENUM ('better', 'as_expected', 'worse');

-- CreateEnum
CREATE TYPE "TriggeredBy" AS ENUM ('system', 'client_override', 'early_override');

-- CreateEnum
CREATE TYPE "ApiCallStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "RiskAppetite" AS ENUM ('conservative', 'moderate', 'aggressive');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('open', 'applied', 'dismissed', 'superseded');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerk_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "plan_tier" "PlanTier" NOT NULL DEFAULT 'free',
    "notification_preferences" JSONB NOT NULL DEFAULT '{"email":true,"slack":false,"inApp":true}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "access_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "platform_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "scaling_state" "ScalingState" NOT NULL DEFAULT 'idle',
    "budget_level" TEXT NOT NULL DEFAULT 'campaign',
    "budget_entity_id" TEXT,
    "current_daily_budget" DECIMAL(12,2),
    "launched_at" TIMESTAMP(3),
    "brief_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_briefs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_daily_budget" DECIMAL(12,2) NOT NULL,
    "current_daily_spend" DECIMAL(12,2) NOT NULL,
    "current_daily_conversions" DECIMAL(12,2) NOT NULL,
    "current_roas" DECIMAL(8,3) NOT NULL,
    "current_cpa" DECIMAL(12,2) NOT NULL,
    "current_ctr" DECIMAL(8,5) NOT NULL,
    "avg_order_value" DECIMAL(12,2) NOT NULL,
    "campaign_age_days" INTEGER NOT NULL,
    "active_creative_count" INTEGER NOT NULL,
    "target_daily_conversions" INTEGER NOT NULL,
    "target_roas" DECIMAL(8,3),
    "target_cpa" DECIMAL(12,2),
    "target_daily_budget" DECIMAL(12,2),
    "target_timeline_weeks" INTEGER,
    "max_budget_cap" DECIMAL(12,2) NOT NULL,
    "min_acceptable_roas" DECIMAL(8,3) NOT NULL,
    "max_acceptable_cpa" DECIMAL(12,2) NOT NULL,
    "product_margin_pct" DECIMAL(5,4) NOT NULL,
    "scale_preference" "ScalePreference" NOT NULL,
    "creative_refresh_frequency" "RefreshFrequency" NOT NULL,
    "creatives_in_production" INTEGER NOT NULL DEFAULT 0,
    "formats_available" TEXT[],
    "blackout_dates" JSONB NOT NULL DEFAULT '[]',
    "thresholds" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scaling_roadmaps" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "brief_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projected_cycles" JSONB NOT NULL,
    "estimated_weeks" DECIMAL(5,1) NOT NULL,
    "estimated_creatives_needed" INTEGER NOT NULL,
    "assumptions" JSONB NOT NULL,
    "actual_vs_projected" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "scaling_roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "platform_ad_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "length_sec" INTEGER,
    "angle" TEXT,
    "visual_style" TEXT,
    "tone" TEXT,
    "thumbnail_url" TEXT,
    "launched_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_snapshots" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "ctr" DECIMAL(8,5) NOT NULL,
    "cpm" DECIMAL(12,4) NOT NULL,
    "roas" DECIMAL(8,3) NOT NULL,
    "cpa" DECIMAL(12,2),
    "conversions" DECIMAL(12,2) NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "frequency" DECIMAL(6,3) NOT NULL,
    "video_completion_rate" DECIMAL(6,5),
    "thumb_stop_rate" DECIMAL(6,5),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "trigger" "AnalysisTrigger" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_scores" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "analysis_run_id" TEXT NOT NULL,
    "score" INTEGER,
    "hook_rate" DECIMAL(6,5),
    "ctr" DECIMAL(8,5) NOT NULL,
    "roas" DECIMAL(8,3) NOT NULL,
    "cpa" DECIMAL(12,2),
    "frequency" DECIMAL(6,3) NOT NULL,
    "completion_rate" DECIMAL(6,5),
    "trend" "CreativeTrend" NOT NULL,
    "fatigue_flag" BOOLEAN NOT NULL DEFAULT false,
    "fatigue_reason" TEXT,
    "snapshot_date" DATE NOT NULL,

    CONSTRAINT "creative_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_briefs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "analysis_run_id" TEXT NOT NULL,
    "creative_health_score" INTEGER NOT NULL,
    "creatives_needed" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "winning_patterns" JSONB NOT NULL,
    "creatives_to_retire" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notification_sent_at" TIMESTAMP(3),

    CONSTRAINT "creative_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_items" (
    "id" TEXT NOT NULL,
    "creative_brief_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "suggested_format" TEXT NOT NULL,
    "suggested_angle" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "what_to_avoid" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "BriefItemStatus" NOT NULL DEFAULT 'pending',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brief_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scaling_recommendations" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'open',
    "decision" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "scaling_health_score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "scaling_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scaling_cycles" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "cycle_number" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'executing',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldown_ends_at" TIMESTAMP(3) NOT NULL,
    "budget_before" DECIMAL(12,2) NOT NULL,
    "budget_after" DECIMAL(12,2) NOT NULL,
    "pct_change" DECIMAL(6,2) NOT NULL,
    "system_recommendation_pct" DECIMAL(6,2) NOT NULL,
    "client_chosen_pct" DECIMAL(6,2) NOT NULL,
    "override_flag" BOOLEAN NOT NULL,
    "early_trigger_flag" BOOLEAN NOT NULL DEFAULT false,
    "day_of_cooldown_when_triggered" INTEGER,
    "cooldown_length" INTEGER,
    "ceiling_override_flag" BOOLEAN NOT NULL DEFAULT false,
    "trigger_metrics" JSONB NOT NULL,
    "system_rationale" TEXT NOT NULL,
    "post_cycle_roas" DECIMAL(8,3),
    "post_cycle_cpa" DECIMAL(12,2),
    "post_cycle_conversions" DECIMAL(12,2),
    "post_cycle_metrics" JSONB,
    "outcome_vs_prediction" "CycleOutcome",
    "ceiling_detected" BOOLEAN NOT NULL DEFAULT false,
    "ceiling_reason" TEXT,
    "system_note" TEXT,

    CONSTRAINT "scaling_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scaling_logs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "action_type" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "triggered_by" "TriggeredBy" NOT NULL,
    "api_call_status" "ApiCallStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scaling_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_scaling_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "total_cycles" INTEGER NOT NULL DEFAULT 0,
    "total_overrides" INTEGER NOT NULL DEFAULT 0,
    "override_outperformed_count" INTEGER NOT NULL DEFAULT 0,
    "avg_client_vs_system_delta" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "risk_appetite" "RiskAppetite" NOT NULL DEFAULT 'moderate',
    "auto_calculated" BOOLEAN NOT NULL DEFAULT true,
    "manually_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "insights_shown" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_scaling_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_user_id_platform_account_id_key" ON "ad_accounts"("user_id", "platform", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_brief_id_key" ON "campaigns"("brief_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_ad_account_id_platform_campaign_id_key" ON "campaigns"("ad_account_id", "platform_campaign_id");

-- CreateIndex
CREATE INDEX "campaign_briefs_campaign_id_submitted_at_idx" ON "campaign_briefs"("campaign_id", "submitted_at");

-- CreateIndex
CREATE INDEX "scaling_roadmaps_campaign_id_generated_at_idx" ON "scaling_roadmaps"("campaign_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ads_campaign_id_platform_ad_id_key" ON "ads"("campaign_id", "platform_ad_id");

-- CreateIndex
CREATE INDEX "performance_snapshots_campaign_id_date_idx" ON "performance_snapshots"("campaign_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "performance_snapshots_campaign_id_ad_id_date_key" ON "performance_snapshots"("campaign_id", "ad_id", "date");

-- CreateIndex
CREATE INDEX "analysis_runs_campaign_id_started_at_idx" ON "analysis_runs"("campaign_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "creative_scores_analysis_run_id_ad_id_key" ON "creative_scores"("analysis_run_id", "ad_id");

-- CreateIndex
CREATE UNIQUE INDEX "creative_briefs_analysis_run_id_key" ON "creative_briefs"("analysis_run_id");

-- CreateIndex
CREATE INDEX "creative_briefs_campaign_id_generated_at_idx" ON "creative_briefs"("campaign_id", "generated_at");

-- CreateIndex
CREATE INDEX "scaling_recommendations_campaign_id_created_at_idx" ON "scaling_recommendations"("campaign_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scaling_cycles_recommendation_id_key" ON "scaling_cycles"("recommendation_id");

-- CreateIndex
CREATE INDEX "scaling_cycles_campaign_id_started_at_idx" ON "scaling_cycles"("campaign_id", "started_at");

-- CreateIndex
CREATE INDEX "scaling_logs_campaign_id_timestamp_idx" ON "scaling_logs"("campaign_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "client_scaling_profiles_campaign_id_key" ON "client_scaling_profiles"("campaign_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "campaign_briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_roadmaps" ADD CONSTRAINT "scaling_roadmaps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_roadmaps" ADD CONSTRAINT "scaling_roadmaps_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "campaign_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_scores" ADD CONSTRAINT "creative_scores_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_scores" ADD CONSTRAINT "creative_scores_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_briefs" ADD CONSTRAINT "creative_briefs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_briefs" ADD CONSTRAINT "creative_briefs_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_items" ADD CONSTRAINT "brief_items_creative_brief_id_fkey" FOREIGN KEY ("creative_brief_id") REFERENCES "creative_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_recommendations" ADD CONSTRAINT "scaling_recommendations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_cycles" ADD CONSTRAINT "scaling_cycles_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_cycles" ADD CONSTRAINT "scaling_cycles_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "scaling_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_logs" ADD CONSTRAINT "scaling_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scaling_logs" ADD CONSTRAINT "scaling_logs_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "scaling_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_scaling_profiles" ADD CONSTRAINT "client_scaling_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_scaling_profiles" ADD CONSTRAINT "client_scaling_profiles_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

