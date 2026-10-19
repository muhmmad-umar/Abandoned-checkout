import type { AdSet, EntityStatus, Insights } from "./types.js";

const GRAPH = "https://graph.facebook.com";

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

interface RawAction {
  action_type: string;
  value: string;
}

export class MetaClient {
  constructor(
    private readonly accessToken: string,
    private readonly opts: { version?: string; fetch?: typeof fetch } = {},
  ) {}

  private async request<T>(
    path: string,
    init: { method?: "GET" | "POST"; params?: Record<string, string> } = {},
  ): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const url = new URL(`${GRAPH}/${this.opts.version ?? "v21.0"}/${path}`);
    const method = init.method ?? "GET";
    const params = new URLSearchParams(init.params);
    let body: URLSearchParams | undefined;
    if (method === "GET") params.forEach((v, k) => url.searchParams.set(k, v));
    else body = params;
    const res = await f(url, {
      method,
      body,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    const json = (await res.json()) as T & { error?: { message: string; code: number } };
    if (!res.ok || json.error) {
      throw new MetaApiError(json.error?.message ?? res.statusText, res.status, json.error?.code);
    }
    return json;
  }

  async listAdSets(adAccountId: string): Promise<AdSet[]> {
    const res = await this.request<{ data: Record<string, string>[] }>(`${adAccountId}/adsets`, {
      params: { fields: "id,campaign_id,name,effective_status,daily_budget", limit: "500" },
    });
    return res.data
      .filter((a) => a.daily_budget !== undefined)
      .map((a) => ({
        id: a.id!,
        campaignId: a.campaign_id!,
        name: a.name!,
        status: a.effective_status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        dailyBudget: Number(a.daily_budget),
      }));
  }

  async getAdSetInsights(adSetId: string, datePreset = "last_3d"): Promise<Insights> {
    const res = await this.request<{
      data: {
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: RawAction[];
        action_values?: RawAction[];
      }[];
    }>(`${adSetId}/insights`, {
      params: { fields: "spend,impressions,clicks,actions,action_values", date_preset: datePreset },
    });
    const row = res.data[0];
    const pick = (xs?: RawAction[]) =>
      Number(xs?.find((x) => x.action_type === "omni_purchase")?.value ?? 0);
    return {
      spend: Number(row?.spend ?? 0),
      impressions: Number(row?.impressions ?? 0),
      clicks: Number(row?.clicks ?? 0),
      purchases: pick(row?.actions),
      purchaseValue: pick(row?.action_values),
    };
  }

  async setDailyBudget(adSetId: string, dailyBudget: number): Promise<void> {
    await this.request(adSetId, {
      method: "POST",
      params: { daily_budget: String(Math.round(dailyBudget)) },
    });
  }

  async setStatus(adSetId: string, status: EntityStatus): Promise<void> {
    await this.request(adSetId, { method: "POST", params: { status } });
  }

  async duplicateAdSet(adSetId: string, opts: { dailyBudget?: number } = {}): Promise<string> {
    const params: Record<string, string> = { status_option: "PAUSED", deep_copy: "true" };
    const res = await this.request<{ copied_adset_id: string }>(`${adSetId}/copies`, {
      method: "POST",
      params,
    });
    if (opts.dailyBudget !== undefined) await this.setDailyBudget(res.copied_adset_id, opts.dailyBudget);
    return res.copied_adset_id;
  }
}
