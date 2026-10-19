import { describe, expect, it, vi } from "vitest";
import { buildAuthUrl, createOAuthState, exchangeCodeForLongLivedToken, MetaApiError, MetaClient, parseUsage, verifyOAuthState } from "../src";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body?.toString() });
    const r = replies.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const noSleep = vi.fn(async () => {});

describe("MetaClient", () => {
  it("parses daily ad insights with hook and completion rates", async () => {
    const { f, calls } = fakeFetch([{ body: { data: [{
      ad_id: "a1", date_start: "2026-01-10", spend: "120.50", impressions: "10000", clicks: "180", frequency: "1.9",
      actions: [{ action_type: "video_view", value: "3200" }, { action_type: "omni_purchase", value: "5" }, { action_type: "purchase", value: "99" }],
      action_values: [{ action_type: "omni_purchase", value: "300" }],
      video_play_actions: [{ action_type: "video_view", value: "8000" }],
      video_p100_watched_actions: [{ action_type: "video_view", value: "800" }],
    }] } }]);
    const rows = await new MetaClient("t", { fetch: f }).getAdDailyInsights("c1", "2026-01-10", "2026-01-10");
    expect(rows[0]).toEqual({ adId: "a1", date: "2026-01-10", spend: 120.5, impressions: 10000, clicks: 180, frequency: 1.9, conversions: 5, revenue: 300, thumbStopRate: 0.32, videoCompletionRate: 0.1 });
    expect(calls[0]!.url).toContain("time_increment=1");
    expect(calls[0]!.url).toContain("level=ad");
  });

  it("follows pagination", async () => {
    const { f } = fakeFetch([
      { body: { data: [{ id: "1", name: "A", effective_status: "ACTIVE", daily_budget: "100000" }], paging: { next: "https://graph.facebook.com/v21.0/next" } } },
      { body: { data: [{ id: "2", name: "B", effective_status: "PAUSED" }] } },
    ]);
    const cs = await new MetaClient("t", { fetch: f }).listCampaigns("act_1");
    expect(cs.map((c) => [c.id, c.dailyBudget])).toEqual([["1", 1000], ["2", null]]);
  });

  it("writes budgets in minor units", async () => {
    const { f, calls } = fakeFetch([{ body: { success: true } }]);
    await new MetaClient("t", { fetch: f }).setDailyBudget("c1", 1440.5);
    expect(calls[0]).toMatchObject({ method: "POST", body: "daily_budget=144050" });
  });

  it("finds a CBO budget, or the single ad-set budget", async () => {
    const cbo = fakeFetch([{ body: { id: "c1", daily_budget: "120000" } }]);
    expect(await new MetaClient("t", { fetch: cbo.f }).getBudgetTarget("c1")).toEqual({ level: "campaign", id: "c1", dailyBudget: 1200 });
    const abo = fakeFetch([{ body: { id: "c1" } }, { body: { data: [{ id: "s1", daily_budget: "50000", effective_status: "ACTIVE" }] } }]);
    expect(await new MetaClient("t", { fetch: abo.f }).getBudgetTarget("c1")).toEqual({ level: "adset", id: "s1", dailyBudget: 500 });
  });

  it("refuses to scale campaigns with several ad-set budgets", async () => {
    const { f } = fakeFetch([{ body: { id: "c1" } }, { body: { data: [
      { id: "s1", daily_budget: "50000", effective_status: "ACTIVE" }, { id: "s2", daily_budget: "50000", effective_status: "ACTIVE" },
    ] } }]);
    await expect(new MetaClient("t", { fetch: f }).getBudgetTarget("c1")).rejects.toThrow(/2 active ad-set budgets/);
  });

  it("detects carousel / video / static creatives", async () => {
    const { f } = fakeFetch([{ body: { data: [
      { id: "1", name: "car", effective_status: "ACTIVE", creative: { id: "x", object_story_spec: { link_data: { child_attachments: [{}, {}] } } } },
      { id: "2", name: "vid", effective_status: "ACTIVE", creative: { id: "y", video_id: "v9" } },
      { id: "3", name: "img", effective_status: "ACTIVE", creative: { id: "z" } },
    ] } }]);
    const ads = await new MetaClient("t", { fetch: f }).listAds("c1");
    expect(ads.map((a) => a.format)).toEqual(["carousel", "video", "static"]);
    expect(ads[1]!.videoId).toBe("v9");
  });

  it("retries rate limits, waiting as long as Meta asks", async () => {
    const usage = JSON.stringify({ act_1: [{ call_count: 100, total_cputime: 40, total_time: 40, estimated_time_to_regain_access: 2 }] });
    const { f } = fakeFetch([
      { status: 400, body: { error: { message: "User request limit reached", code: 17 } }, headers: { "x-business-use-case-usage": usage } },
      { body: { data: [] } },
    ]);
    const sleep = vi.fn(async (_ms: number) => {});
    await new MetaClient("t", { fetch: f, sleep }).listCampaigns("act_1");
    expect(sleep.mock.calls).toEqual([[120_000]]);
  });

  it("retries 5xx with backoff, then gives up", async () => {
    const { f } = fakeFetch(Array.from({ length: 3 }, () => ({ status: 500, body: { error: { message: "boom", code: 1 } } })));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(new MetaClient("t", { fetch: f, sleep, maxRetries: 2 }).listCampaigns("act_1")).rejects.toBeInstanceOf(MetaApiError);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("does not retry auth errors", async () => {
    const { f, calls } = fakeFetch([{ status: 401, body: { error: { message: "Invalid OAuth access token", code: 190 } } }]);
    const err = await new MetaClient("t", { fetch: f, sleep: noSleep }).listCampaigns("act_1").catch((e) => e);
    expect(err.isAuthError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("parseUsage", () => {
  it("reads the highest usage across headers", () => {
    const h = new Headers({ "x-app-usage": JSON.stringify({ call_count: 12, total_cputime: 30, total_time: 5 }) });
    expect(parseUsage(h)).toEqual({ maxPct: 30, regainAccessSec: 0 });
    expect(parseUsage(new Headers({ "x-app-usage": "not json" }))).toEqual({ maxPct: 0, regainAccessSec: 0 });
  });
});

describe("OAuth", () => {
  const cfg = { appId: "123", appSecret: "s", redirectUri: "https://app.test/meta/callback" };
  it("signs and verifies state", () => {
    const s = createOAuthState("user_1", "secret", 60_000, 1000);
    expect(verifyOAuthState(s, "secret", 2000)).toBe("user_1");
    expect(verifyOAuthState(s, "other", 2000)).toBeNull();
    expect(verifyOAuthState(s, "secret", 70_000)).toBeNull();
    expect(verifyOAuthState(s.replace("user_1", "user_2"), "secret", 2000)).toBeNull();
  });
  it("builds the dialog URL with ads scopes", () => {
    const u = new URL(buildAuthUrl(cfg, "st"));
    expect(u.searchParams.get("scope")).toBe("ads_management,ads_read,business_management");
    expect(u.searchParams.get("state")).toBe("st");
  });
  it("exchanges the code for a long-lived token", async () => {
    const { f, calls } = fakeFetch([{ body: { access_token: "short", expires_in: 3600 } }, { body: { access_token: "long", expires_in: 5_184_000 } }]);
    const t = await exchangeCodeForLongLivedToken(cfg, "code", f, 0);
    expect(t).toEqual({ accessToken: "long", expiresAt: new Date(5_184_000_000) });
    expect(calls[1]!.url).toContain("grant_type=fb_exchange_token");
  });
});
