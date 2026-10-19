import { describe, expect, it, vi } from "vitest";
import { emailChannel, inAppChannel, isSlackWebhook, NotificationService, renderEmailHtml, slackChannel, templates, type Recipient } from "../src";

const campaign = { id: "c1", name: "Spring Sale" };
const recipient = (prefs: Recipient["preferences"] = {}): Recipient => ({ userId: "u1", email: "a@b.test", preferences: prefs });

describe("templates", () => {
  it("uses the spec's creative brief copy", () => {
    expect(templates.creativeBriefReady(campaign, 4, "https://app.test/c/c1/brief").body).toBe(
      "Your campaign Spring Sale needs 4 new creatives. Your creative brief is ready. Review it here → https://app.test/c/c1/brief",
    );
    expect(templates.creativeBriefReady(campaign, 1, "x").body).toContain("needs 1 new creative.");
  });
  it("uses the spec's ceiling copy", () => {
    expect(templates.ceilingDetected(campaign, ["CPM rose 33%"], "x").body).toMatch(/^Campaign Spring Sale has reached its scaling ceiling\. Further increases are likely to reduce performance\. Recommended: refresh creatives before scaling again\./);
  });
});

describe("NotificationService", () => {
  it("delivers to enabled channels and isolates failures", async () => {
    const store = vi.fn(async () => ({}));
    const sender = vi.fn(async () => { throw new Error("smtp down"); });
    const f = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    const svc = new NotificationService([inAppChannel(store), emailChannel(sender), slackChannel(f)]);
    const res = await svc.send(recipient({ slack: true, slackWebhookUrl: "https://hooks.slack.com/services/T/B/X" }), templates.goalReached(campaign, 100, "https://app.test"));
    expect(res).toEqual([
      { channel: "in_app", ok: true },
      { channel: "email", ok: false, error: "smtp down" },
      { channel: "slack", ok: true },
    ]);
    expect(store).toHaveBeenCalledOnce();
  });
  it("respects preferences", async () => {
    const store = vi.fn(async () => ({}));
    const sender = vi.fn(async () => {});
    const svc = new NotificationService([inAppChannel(store), emailChannel(sender), slackChannel()]);
    const res = await svc.send(recipient({ email: false, inApp: true }), templates.goalReached(campaign, 100, "x"));
    expect(res.map((r) => r.channel)).toEqual(["in_app"]);
  });
});

describe("channels", () => {
  it("only accepts real Slack webhook URLs", () => {
    expect(isSlackWebhook("https://hooks.slack.com/services/a")).toBe(true);
    expect(isSlackWebhook("http://hooks.slack.com/services/a")).toBe(false);
    expect(isSlackWebhook("https://evil.test/hooks.slack.com")).toBe(false);
    expect(isSlackWebhook(undefined)).toBe(false);
  });
  it("escapes email HTML", () => {
    const html = renderEmailHtml({ kind: "goal_reached", title: "<b>x</b>", body: "a & b\nc", link: "https://app.test" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a &amp; b<br>c");
  });
});
