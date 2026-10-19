/**
 * Local demo mode: a fixed user instead of Clerk, so the dashboard runs without accounts.
 * Only honoured outside production; `next build`/`next start` always use Clerk.
 */
export const devAuthUser: string | undefined =
  process.env.NODE_ENV !== "production" ? process.env.DEV_AUTH_USER || undefined : undefined;
