export type EntityStatus = "ACTIVE" | "PAUSED";

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: EntityStatus;
  /** Daily budget in the account currency's minor unit (e.g. cents). */
  dailyBudget: number;
}

export interface Insights {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

export interface MetricsSnapshot extends Insights {
  roas: number;
  cpa: number | null;
  ctr: number;
}

export function toSnapshot(i: Insights): MetricsSnapshot {
  return {
    ...i,
    roas: i.spend > 0 ? i.purchaseValue / i.spend : 0,
    cpa: i.purchases > 0 ? i.spend / i.purchases : null,
    ctr: i.impressions > 0 ? i.clicks / i.impressions : 0,
  };
}
