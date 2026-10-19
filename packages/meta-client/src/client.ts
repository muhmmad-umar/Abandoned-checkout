import { MetaApiError, parseUsage, type UsageInfo } from "./http";
import type { MetaAd, MetaAdDaily, MetaBudgetTarget, MetaCampaign } from "./types";

const GRAPH = "https://graph.facebook.com";

export interface MetaClientOptions {
  /** Graph API version; v19.0 or newer. */
  version?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** Pause proactively when reported usage reaches this %. Default 90. */
  throttleAtPct?: number;
  /** Conversion action types, in priority order; the first present is used. */
  conversionActionTypes?: string[];
  /** Minor units per major unit for this account's currency (100 for USD, 1 for JPY). */
  currencyOffset?: number;
}

interface RawAction {
  action_type: string;
  value: string;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

const DEFAULT_CONVERSIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

/**
 * Thin, typed wrapper over the Meta Marketing API.
 * Handles pagination, rate limits (usage headers + throttling error codes, with backoff),
 * and minor-unit budget conversion. Contains no business logic.
 */
export class MetaClient {
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly version: string;
  private readonly offset: number;
  private readonly conversions: string[];
  lastUsage: UsageInfo = { maxPct: 0, regainAccessSec: 0 };

  constructor(private readonly accessToken: string, private readonly opts: MetaClientOptions = {}) {
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.version = opts.version ?? "v21.0";
    this.offset = opts.currencyOffset ?? 100;
    this.conversions = opts.conversionActionTypes ?? DEFAULT_CONVERSIONS;
  }

  /** Low-level request with retry. `path` is relative to the versioned Graph root, or a full paging URL. */
  async request<T>(path: string, init: { method?: "GET" | "POST"; params?: Record<string, string> } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const maxRetries = this.opts.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      if (this.lastUsage.maxPct >= (this.opts.throttleAtPct ?? 90) && this.lastUsage.regainAccessSec > 0) {
        await this.sleep(this.lastUsage.regainAccessSec * 1000);
        this.lastUsage = { maxPct: 0, regainAccessSec: 0 };
      }
      const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${this.version}/${path}`);
      let body: URLSearchParams | undefined;
      if (method === "GET") for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
      else body = new URLSearchParams(init.params);

      let err: MetaApiError;
      try {
        const res = await this.f(url, { method, body, headers: { Authorization: `Bearer ${this.accessToken}` } });
        this.lastUsage = parseUsage(res.headers);
        const json = (await res.json().catch(() => ({}))) as T & {
          error?: { message: string; code: number; error_subcode?: number; fbtrace_id?: string };
        };
        if (res.ok && !json.error) return json;
        const e = json.error;
        err = new MetaApiError(e?.message ?? res.statusText, res.status, e?.code, e?.error_subcode, e?.fbtrace_id);
      } catch (e) {
        if (e instanceof MetaApiError) throw e;
        err = new MetaApiError(e instanceof Error ? e.message : "Network error", 0, 2);
      }
      if (!err.isTransient || attempt >= maxRetries) throw err;
      const wait = err.isRateLimit && this.lastUsage.regainAccessSec > 0
        ? this.lastUsage.regainAccessSec * 1000
        : Math.min(60_000, 1000 * 2 ** attempt);
      await this.sleep(wait);
      // The wait already covered the reported regain time.
      this.lastUsage = { maxPct: 0, regainAccessSec: 0 };
    }
  }

  private async all<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let page = await this.request<Paged<T>>(path, { params: { limit: "500", ...params } });
    out.push(...page.data);
    while (page.paging?.next) {
      page = await this.request<Paged<T>>(page.paging.next);
      out.push(...page.data);
    }
    return out;
  }

  private toMajor(minor: string | undefined): number | null {
    return minor == null ? null : Number(minor) / this.offset;
  }

  async listAdAccounts(): Promise<{ id: string; name: string; currency: string }[]> {
    return this.all("me/adaccounts", { fields: "id,name,currency" });
  }

  async listCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
    const rows = await this.all<Record<string, string>>(`${adAccountId}/campaigns`, {
      fields: "id,name,effective_status,daily_budget,start_time,objective",
    });
    return rows.map((r) => ({
      id: r.id!,
      name: r.name!,
      status: r.effective_status!,
      objective: r.objective ?? null,
      dailyBudget: this.toMajor(r.daily_budget),
      startTime: r.start_time ? new Date(r.start_time) : null,
    }));
  }

  /**
   * Where the campaign's daily budget lives: on the campaign (CBO), or on its single ad set.
   * Campaigns with ad-set budgets across several ad sets are not supported for scaling yet.
   */
  async getBudgetTarget(campaignId: string): Promise<MetaBudgetTarget> {
    const c = await this.request<{ id: string; daily_budget?: string }>(campaignId, { params: { fields: "id,daily_budget" } });
    if (c.daily_budget) return { level: "campaign", id: c.id, dailyBudget: this.toMajor(c.daily_budget)! };
    const sets = await this.all<{ id: string; daily_budget?: string; effective_status: string }>(`${campaignId}/adsets`, {
      fields: "id,daily_budget,effective_status",
    });
    const active = sets.filter((s) => s.daily_budget && s.effective_status === "ACTIVE");
    if (active.length !== 1) {
      throw new MetaApiError(`Campaign ${campaignId} has ${active.length} active ad-set budgets; use campaign budget (CBO) to scale it.`, 400);
    }
    return { level: "adset", id: active[0]!.id, dailyBudget: this.toMajor(active[0]!.daily_budget)! };
  }

  /** Sets a daily budget (major units) on a campaign or ad set. */
  async setDailyBudget(entityId: string, dailyBudget: number): Promise<void> {
    await this.request(entityId, { method: "POST", params: { daily_budget: String(Math.round(dailyBudget * this.offset)) } });
  }

  /** Ads in a campaign, with creative format/length detection. */
  async listAds(campaignId: string): Promise<MetaAd[]> {
    const rows = await this.all<{
      id: string;
      name: string;
      effective_status: string;
      created_time?: string;
      creative?: { id: string; object_type?: string; video_id?: string; thumbnail_url?: string; asset_feed_spec?: unknown; object_story_spec?: { video_data?: { video_id?: string }; link_data?: { child_attachments?: unknown[] } } };
    }>(`${campaignId}/ads`, {
      fields: "id,name,effective_status,created_time,creative{id,object_type,video_id,thumbnail_url,object_story_spec}",
    });
    return rows.map((r) => {
      const cr = r.creative;
      const videoId = cr?.video_id ?? cr?.object_story_spec?.video_data?.video_id ?? null;
      const carousel = (cr?.object_story_spec?.link_data?.child_attachments?.length ?? 0) > 1;
      return {
        id: r.id,
        name: r.name,
        status: r.effective_status,
        format: carousel ? "carousel" : videoId ? "video" : "static",
        videoId,
        thumbnailUrl: cr?.thumbnail_url ?? null,
        createdAt: r.created_time ? new Date(r.created_time) : null,
      };
    });
  }

  /** Video lengths in seconds, keyed by video id. */
  async getVideoLengths(videoIds: string[]): Promise<Record<string, number>> {
    if (!videoIds.length) return {};
    const out: Record<string, number> = {};
    for (let i = 0; i < videoIds.length; i += 50) {
      const ids = videoIds.slice(i, i + 50).join(",");
      const res = await this.request<Record<string, { length?: number }>>("", { params: { ids, fields: "length" } });
      for (const [id, v] of Object.entries(res)) if (v.length != null) out[id] = Math.round(v.length);
    }
    return out;
  }

  /**
   * Daily ad-level insights for a campaign between two dates (inclusive, account time zone).
   * Hook rate = 3-second video views / impressions. Completion = 100% views / plays.
   */
  async getAdDailyInsights(campaignId: string, since: string, until: string): Promise<MetaAdDaily[]> {
    const rows = await this.all<Record<string, unknown>>(`${campaignId}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields: "ad_id,date_start,spend,impressions,clicks,reach,frequency,actions,action_values,video_play_actions,video_p100_watched_actions",
    });
    const pick = (xs: unknown, types: string[]): number => {
      const list = (xs as RawAction[] | undefined) ?? [];
      for (const t of types) {
        const hit = list.find((x) => x.action_type === t);
        if (hit) return Number(hit.value);
      }
      return 0;
    };
    return rows.map((r) => {
      const impressions = Number(r.impressions ?? 0);
      const views3s = pick(r.actions, ["video_view"]);
      const plays = pick(r.video_play_actions, ["video_view"]);
      const completes = pick(r.video_p100_watched_actions, ["video_view"]);
      return {
        adId: String(r.ad_id),
        date: String(r.date_start),
        spend: Number(r.spend ?? 0),
        impressions,
        clicks: Number(r.clicks ?? 0),
        frequency: Number(r.frequency ?? 0),
        conversions: pick(r.actions, this.conversions),
        revenue: pick(r.action_values, this.conversions),
        thumbStopRate: plays > 0 && impressions > 0 ? views3s / impressions : null,
        videoCompletionRate: plays > 0 ? completes / plays : null,
      };
    });
  }
}
