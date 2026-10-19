import type { NotificationMessage } from "./templates";

export interface Recipient {
  userId: string;
  email: string;
  preferences: { email?: boolean; slack?: boolean; inApp?: boolean; slackWebhookUrl?: string };
}

export interface Channel {
  name: "in_app" | "email" | "slack";
  enabledFor(r: Recipient): boolean;
  send(r: Recipient, m: NotificationMessage): Promise<void>;
}

export type DeliveryResult = { channel: Channel["name"]; ok: true } | { channel: Channel["name"]; ok: false; error: string };

/** Sends a message on every channel the recipient has enabled. One failing channel never blocks the others. */
export class NotificationService {
  constructor(private readonly channels: Channel[]) {}

  async send(recipient: Recipient, message: NotificationMessage): Promise<DeliveryResult[]> {
    const active = this.channels.filter((c) => c.enabledFor(recipient));
    return Promise.all(
      active.map(async (c): Promise<DeliveryResult> => {
        try {
          await c.send(recipient, message);
          return { channel: c.name, ok: true };
        } catch (e) {
          return { channel: c.name, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }
}

/** In-app notifications; `store` persists the row (e.g. prisma.notification.create). */
export function inAppChannel(store: (userId: string, m: NotificationMessage) => Promise<unknown>): Channel {
  return {
    name: "in_app",
    enabledFor: (r) => r.preferences.inApp !== false,
    send: async (r, m) => void (await store(r.userId, m)),
  };
}

export type EmailSender = (e: { to: string; subject: string; text: string; html: string }) => Promise<void>;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmailHtml(m: NotificationMessage): string {
  const body = escapeHtml(m.body).replace(/\n/g, "<br>");
  const cta = m.link ? `<p><a href="${escapeHtml(m.link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Open in Ad Scaler</a></p>` : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px"><h2 style="font-size:18px">${escapeHtml(m.title)}</h2><p>${body}</p>${cta}</div>`;
}

export function emailChannel(sender: EmailSender): Channel {
  return {
    name: "email",
    enabledFor: (r) => r.preferences.email !== false && !!r.email,
    send: (r, m) => sender({ to: r.email, subject: m.title, text: m.body, html: renderEmailHtml(m) }),
  };
}

/** Email via Resend. */
export async function resendSender(apiKey: string, from: string): Promise<EmailSender> {
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  return async (e) => {
    const { error } = await resend.emails.send({ from, ...e });
    if (error) throw new Error(error.message);
  };
}

export function slackPayload(m: NotificationMessage) {
  const text = m.link ? m.body.replace(` → ${m.link}`, ` → <${m.link}|Open>`) : m.body;
  return {
    text: `${m.title}: ${m.body}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: m.title.slice(0, 150) } },
      { type: "section", text: { type: "mrkdwn", text } },
    ],
  };
}

/** Slack incoming webhook. Only https://hooks.slack.com URLs are accepted, so a stored URL can't be pointed elsewhere. */
export function slackChannel(f: typeof fetch = fetch): Channel {
  return {
    name: "slack",
    enabledFor: (r) => r.preferences.slack === true && isSlackWebhook(r.preferences.slackWebhookUrl),
    send: async (r, m) => {
      const res = await f(r.preferences.slackWebhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload(m)),
      });
      if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
    },
  };
}

export function isSlackWebhook(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}
