import { describe, expect, it, vi } from "vitest";
import { MetaClient, MetaApiError } from "../src/meta/client.js";

const mk = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 400, statusText: "Bad", json: async () => body }) as Response);

describe("MetaClient", () => {
  it("parses insights", async () => {
    const f = mk({ data: [{ spend: "50.5", impressions: "1000", clicks: "20",
      actions: [{ action_type: "omni_purchase", value: "3" }],
      action_values: [{ action_type: "omni_purchase", value: "150" }] }] });
    const c = new MetaClient("t", { fetch: f as unknown as typeof fetch });
    expect(await c.getAdSetInsights("1")).toEqual({ spend: 50.5, impressions: 1000, clicks: 20, purchases: 3, purchaseValue: 150 });
  });
  it("throws MetaApiError on API errors", async () => {
    const c = new MetaClient("t", { fetch: mk({ error: { message: "bad token", code: 190 } }, false) as unknown as typeof fetch });
    await expect(c.listAdSets("act_1")).rejects.toBeInstanceOf(MetaApiError);
  });
});
