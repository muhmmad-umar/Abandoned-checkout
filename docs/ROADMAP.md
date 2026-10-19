# Meta Ads Scaler: roadmap

Multi-tenant SaaS for scaling Meta (Facebook/Instagram) ads. Built in phases.

## Phase 1: Scaling engine (this commit)
- [x] Typed Meta Marketing API client (ad sets, insights, budget, status, duplicate)
- [x] Pure rules engine with guardrails (24h increase cap, min/max budget, min-spend, cooldown)
- [x] Prisma schema: workspaces, members, ad accounts, rules, audit log

## Phase 2: Runner + app shell
- [ ] Worker: per account, fetch ad sets, insights, evaluate, then log or apply
- [ ] Dry-run / approval mode by default (`autoApply=false`)
- [ ] Next.js app: auth, workspaces, rule builder, action log
- [ ] Meta OAuth (long-lived tokens, encrypted at rest)

## Phase 3: Analytics dashboard
- [ ] Insights sync to Postgres; ROAS/CPA/spend trends, breakdowns
- [ ] Recommendations ("scale these 3, kill these 2")

## Phase 4: Creative testing
- [ ] Bulk launch creative x copy x audience matrices
- [ ] Winner detection and auto-promotion to scaling campaigns

## Phase 5: SaaS
- [ ] Stripe billing, plan limits, Meta App Review (`ads_management`, `ads_read`)
- [ ] Rate-limit handling (Meta usage headers), webhooks, alerts

## Notes
- Money is stored in minor units, matching the Meta API.
- Budget increases above ~20% can reset the learning phase, hence the default cap.
- Everything defaults to dry-run so customers can trust it before it spends.
