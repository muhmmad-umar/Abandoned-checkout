import type { PrismaClient, User } from "@ad-scaler/db";
import type { MetaAppConfig, MetaCampaign, TokenResult } from "@ad-scaler/meta-client";
import type { AnalysisTriggerName, ExecuteRequest, ExecuteResult } from "@ad-scaler/queue";
import type { FastifyRequest } from "fastify";

export interface AuthIdentity {
  clerkId: string;
  email: string;
  name?: string | null;
}

/** Everything the API depends on, injected so routes can be tested without Clerk, Meta or Redis. */
export interface ApiServices {
  db: PrismaClient;
  authenticate(req: FastifyRequest): Promise<AuthIdentity | null>;
  jobs: {
    schedule(campaignId: string, creativeIntervalDays: number): Promise<void>;
    unschedule(campaignId: string): Promise<void>;
    sync(campaignId: string): Promise<void>;
    creativeAnalysis(campaignId: string, trigger: AnalysisTriggerName): Promise<void>;
    evaluateScaling(campaignId: string): Promise<void>;
    execute(req: ExecuteRequest): Promise<ExecuteResult>;
  };
  meta: {
    app: MetaAppConfig;
    exchangeCode(code: string): Promise<TokenResult>;
    listAdAccounts(token: string): Promise<{ id: string; name: string; currency: string }[]>;
    listCampaigns(token: string, adAccountId: string): Promise<MetaCampaign[]>;
  };
  secrets: { tokenKey: string; oauthState: string };
  appUrl: string;
  now(): Date;
}

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}
