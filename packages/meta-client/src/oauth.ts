import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MetaApiError } from "./http";

export const META_SCOPES = ["ads_management", "ads_read", "business_management"];

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  version?: string;
}

/**
 * Signed, expiring OAuth `state` that binds the callback to the user who started it.
 * Format: `<userId>.<expiresAtMs>.<nonce>.<hmac>`
 */
export function createOAuthState(userId: string, secret: string, ttlMs = 10 * 60_000, now = Date.now()): string {
  const payload = `${userId}.${now + ttlMs}.${randomBytes(8).toString("hex")}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

/** Returns the user id from a valid state, or null if tampered or expired. */
export function verifyOAuthState(state: string, secret: string, now = Date.now()): string | null {
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const payload = state.slice(0, i);
  const sig = Buffer.from(state.slice(i + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("base64url"));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const [userId, exp] = payload.split(".");
  if (!userId || !exp || Number(exp) < now) return null;
  return userId;
}

export function buildAuthUrl(cfg: MetaAppConfig, state: string): string {
  const u = new URL(`https://www.facebook.com/${cfg.version ?? "v21.0"}/dialog/oauth`);
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", META_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export interface TokenResult {
  accessToken: string;
  expiresAt: Date | null;
}

async function tokenCall(cfg: MetaAppConfig, params: Record<string, string>, f: typeof fetch, now: number): Promise<TokenResult> {
  const u = new URL(`https://graph.facebook.com/${cfg.version ?? "v21.0"}/oauth/access_token`);
  for (const [k, v] of Object.entries({ client_id: cfg.appId, client_secret: cfg.appSecret, ...params })) u.searchParams.set(k, v);
  const res = await f(u);
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string; code: number } };
  if (!res.ok || !json.access_token) throw new MetaApiError(json.error?.message ?? "Token exchange failed", res.status, json.error?.code);
  return { accessToken: json.access_token, expiresAt: json.expires_in ? new Date(now + json.expires_in * 1000) : null };
}

/** Exchanges the OAuth code for a long-lived (~60 day) user token. */
export async function exchangeCodeForLongLivedToken(cfg: MetaAppConfig, code: string, f: typeof fetch = fetch, now = Date.now()): Promise<TokenResult> {
  const short = await tokenCall(cfg, { redirect_uri: cfg.redirectUri, code }, f, now);
  return tokenCall(cfg, { grant_type: "fb_exchange_token", fb_exchange_token: short.accessToken }, f, now);
}
