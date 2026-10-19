import type { FastifyInstance } from "fastify";
import { buildAuthUrl, createOAuthState, verifyOAuthState } from "@ad-scaler/meta-client";
import { decryptSecret, encryptSecret } from "@ad-scaler/shared";
import { HttpError, notFound } from "../app";
import type { ApiServices } from "../services";

export const metaRoutes = (s: ApiServices) => async (app: FastifyInstance) => {
  /** Step 1: the web app redirects the browser to this URL. */
  app.get("/meta/connect", async (req) => ({ url: buildAuthUrl(s.meta.app, createOAuthState(req.user.id, s.secrets.oauthState)) }));

  /** Step 2: Meta redirects back here. The signed state identifies the user; no session needed. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/meta/callback", async (req, reply) => {
    const back = (q: string) => reply.redirect(`${s.appUrl}/settings/accounts?${q}`);
    if (req.query.error || !req.query.code || !req.query.state) return back("error=denied");
    const userId = verifyOAuthState(req.query.state, s.secrets.oauthState, s.now().getTime());
    if (!userId) return back("error=expired");

    const token = await s.meta.exchangeCode(req.query.code);
    const accounts = await s.meta.listAdAccounts(token.accessToken);
    const encrypted = encryptSecret(token.accessToken, s.secrets.tokenKey);
    for (const a of accounts) {
      await s.db.adAccount.upsert({
        where: { userId_platform_accountId: { userId, platform: "meta", accountId: a.id } },
        update: { accessToken: encrypted, tokenExpiresAt: token.expiresAt, name: a.name, currency: a.currency, connectedAt: s.now() },
        create: { userId, platform: "meta", accountId: a.id, name: a.name, currency: a.currency, accessToken: encrypted, tokenExpiresAt: token.expiresAt },
      });
    }
    return back(`connected=${accounts.length}`);
  });

  app.get("/ad-accounts", async (req) => {
    const rows = await s.db.adAccount.findMany({
      where: { userId: req.user.id },
      select: { id: true, platform: true, accountId: true, name: true, currency: true, tokenExpiresAt: true, connectedAt: true },
      orderBy: { connectedAt: "desc" },
    });
    const soon = s.now().getTime() + 7 * 86_400_000;
    return rows.map((r) => ({ ...r, needsReconnect: !!r.tokenExpiresAt && r.tokenExpiresAt.getTime() < soon }));
  });

  app.get<{ Params: { id: string } }>("/ad-accounts/:id/platform-campaigns", async (req) => {
    const acct = await s.db.adAccount.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!acct) throw notFound("Ad account not found");
    if (acct.tokenExpiresAt && acct.tokenExpiresAt < s.now()) throw new HttpError(409, "Access to this ad account expired. Reconnect it.", "reconnect_required");
    const imported = new Set((await s.db.campaign.findMany({ where: { adAccountId: acct.id }, select: { platformCampaignId: true } })).map((c) => c.platformCampaignId));
    const campaigns = await s.meta.listCampaigns(decryptSecret(acct.accessToken, s.secrets.tokenKey), acct.accountId);
    return campaigns.map((c) => ({ ...c, imported: imported.has(c.id) }));
  });
};
