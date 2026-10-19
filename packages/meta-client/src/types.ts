export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  /** Major units; null when the budget lives on ad sets. */
  dailyBudget: number | null;
  startTime: Date | null;
}

export interface MetaBudgetTarget {
  level: "campaign" | "adset";
  id: string;
  dailyBudget: number;
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  format: "static" | "video" | "carousel";
  videoId: string | null;
  thumbnailUrl: string | null;
  createdAt: Date | null;
}

export interface MetaAdDaily {
  adId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  frequency: number;
  conversions: number;
  revenue: number;
  thumbStopRate: number | null;
  videoCompletionRate: number | null;
}
