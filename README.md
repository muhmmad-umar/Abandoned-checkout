# Ad Scaler

An AI co-pilot for scaling paid ads. It reads performance, tells the client which creatives to make, recommends budget moves in the client's own numbers, and runs scaling cycles. It never changes a budget silently: every change is a recommendation the client answers.

Each campaign runs two phases:

1. **Creative Intelligence**: score creatives, detect fatigue, find winning patterns, and brief the next batch.
2. **Budget Scaling**: recommend, wait for the client's choice, execute, cool down, and evaluate the outcome.

Nothing runs until the client submits a **Scaling Brief** (current state, target, constraints, creative capacity). From it the system builds a roadmap, a creative requirement plan, and personalized thresholds.

## Layout

```
apps/
  api/              Fastify API (Clerk auth, Meta OAuth, all client actions)
  web/              Next.js 14 dashboard (App Router, Tailwind, shadcn/ui-style components, Clerk)
packages/
  shared/           Scaling Brief types, client-facing formatting, token encryption
  creative-engine/  Phase 1 pure functions
  scaling-engine/   Phase 2 pure functions
  meta-client/      Meta Marketing API wrapper (OAuth, rate limits, insights, budgets)
  db/               Prisma schema, migrations, DB-level guards, row ↔ engine mappers
  queue/            BullMQ queues, schedulers and workers (all side effects live here)
  notifications/    In-app, email (Resend), Slack webhook
```

The two engines have **zero side effects**: no API calls, no DB writes. Workers load data, call the engines, and write the results.

| creative-engine | scaling-engine |
|---|---|
| `scoreCreatives` | `evaluateScaleDecision` |
| `detectFatigue` | `calculateSystemVerdict` |
| `identifyWinningPatterns` | `detectCeiling` |
| `calculateCreativesNeeded` | `calculateScalingHealthScore` |
| `buildBrief` | `shouldBlockScaling` |
| `calculateCreativeHealthScore` | `projectRoadmap` / `buildRoadmap` |
| | `evaluateOutcome`, `planExecution`, `buildOverrideOpinion`, `evaluateEarlyScaleRequest`, `buildScalingProfile`, `buildGoalProgress` |

## Guarantees

- **Never auto-executes.** The scheduled evaluation only writes a recommendation card. A budget changes only when the client calls `POST /campaigns/:id/scale`.
- **Logged before execution.** In one transaction the worker inserts the cycle as `executing` and appends the `scaling_logs` entry, and only then calls Meta. If the call fails, the log and the cycle are marked `failed`, and the cycle number, budget and cooldown don't advance. A change interrupted mid-call (for example, the worker crashes) is reconciled against the live budget.
- **Cooldown enforced in Postgres.** A trigger on `scaling_cycles` rejects a new cycle while `cooldown_ends_at` is in the future (unless it is the client's flagged early override) or while another change is executing. An advisory lock serializes concurrent requests.
- **Append-only audit log.** A trigger rejects `DELETE` on `scaling_logs`, and any `UPDATE` other than resolving a `pending` entry's status.
- **Client constraints are hard limits.** The max budget cap is never exceeded, even on an override. The min ROAS, max CPA and blackout dates stop scaling.
- **The client has final say on the step.** Any % is allowed. The system shows one inline opinion when the choice differs from its own, then proceeds. Scaling early during a cooldown, or past a detected ceiling, is allowed when the client explicitly asks.
- **Tokens are encrypted at rest** (AES-256-GCM). The OAuth `state` is HMAC-signed and expires.

## Dashboard

- **Campaigns**: every campaign with its status, creative health and scaling health.
- **Campaign page**: the goal-progress header is always visible. Below it are five tabs:
  - **Overview** shows exactly one decision card for the current state: the recommendation (with the inline opinion on override), the cooldown with its early-scale request, blocked, ceiling (with continue-anyway), or goal reached (new target, monitor, or pause). Beside it are the scaling-health trend and creative health.
  - **Creatives**: the leaderboard, with inline tagging of angle, visual style and tone.
  - **Creative brief**: winning patterns, one card per creative to make, a status tracker (brief sent → in production → uploaded → live), and creatives to retire.
  - **Scaling timeline**: the cycle log, plus the roadmap projected vs actual.
  - **Override history**: the client's scaling profile and its one-time pattern insight, the override table, and the audit log.
- **Scaling Brief** (`/campaigns/:id/setup`): the four-section form, with a live roadmap, creative plan and thresholds preview. Validation errors from the API show on the field they belong to.
- **Ad accounts**, **Settings** (notification channels, angle taxonomy) and **Notifications**.

All mutations are server actions that call the API with the user's Clerk session token, so the browser never talks to the API directly.

## Try it without Meta or Clerk (demo mode)

Demo mode is for local development only. The API, worker and web app refuse it when `NODE_ENV=production`.

```bash
createdb scaler_demo
export DATABASE_URL=postgresql://localhost/scaler_demo REDIS_URL=redis://localhost:6379 \
  TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) APP_URL=http://localhost:3000 \
  API_URL=http://localhost:4000 DEV_AUTH_USER=demo_user DEMO_MODE=1
npm run db:migrate
npm run seed:demo -- --reset   # wipes this database
npm run dev:api & npm run dev:worker & npm run dev:web
```

The seed replays 30 days through the real jobs against a simulated ad platform, with a scripted client making the choices. It leaves one campaign in each state:

- a recommendation waiting for you
- cooling down (try "Scale now")
- blocked on creative health
- at a scaling ceiling
- a fresh import that still needs its brief

Applying a change from the dashboard runs through the real queue and worker.

## Running locally

Requirements: Node 22, PostgreSQL 16, Redis.

```bash
cp .env.example .env            # fill in the values
npm install                     # also generates the Prisma client
npm run db:migrate              # applies packages/db/prisma/migrations
npm run dev:api                 # http://localhost:4000
npm run dev:worker              # sync / creative / scaling workers
npm run dev:web                 # http://localhost:3000
```

Tests:

```bash
npm test                        # unit tests; the DB/Redis suites skip without env
DATABASE_URL=postgresql://... REDIS_URL=redis://... npm test   # everything
npm run test:engines            # just the two pure engines
npm run typecheck
```

The integration suites run the full lifecycle against real Postgres and Redis with a fake Meta API: sync, Phase 1 brief, recommendation, override, cooldown, early override, API failure rollback, outcome evaluation, crash recovery and ceiling detection. They `TRUNCATE` tables, so point them at a dedicated test database.

## Meta setup

Create a Meta app with the Marketing API product, and request `ads_management`, `ads_read` and `business_management`. Other businesses' accounts need Meta App Review (Advanced Access) before launch. Set `META_REDIRECT_URI` to `<api>/meta/callback`.

Only campaigns with a campaign budget (CBO), or a single active ad-set budget, can be scaled. Campaigns with several ad-set budgets are refused with a clear message.

## Jobs

| Queue | Job | When |
|---|---|---|
| `performance-sync` | `sync-performance` | every 2h per campaign. It re-fetches the last 3 days, because Meta revises recent numbers. A newly fatigued creative triggers Phase 1. |
| `creative` | `creative-analysis` | every 7 days (configurable), on fatigue, on a ceiling, or manually |
| `scaling` | `evaluate-scaling` | every 6h and after each sync. It notifies only when the campaign's scaling state changes. |
| `scaling` | `execute-scaling` | on the client's choice; never retried automatically |

## API overview

- `GET /meta/connect`, `GET /meta/callback`: connect Meta ad accounts
- `GET /ad-accounts`, `GET /ad-accounts/:id/platform-campaigns`, `POST /campaigns`: import a campaign
- `POST /campaigns/:id/roadmap/preview`: live roadmap while filling in the brief
- `POST /campaigns/:id/brief`: submit the Scaling Brief, which starts automation
- `GET /campaigns`, `GET /campaigns/:id`: list with health scores; goal header, recommendation, cooldown, health trend
- `POST /campaigns/:id/recommendation/opinion`: the inline opinion for a chosen %
- `POST /campaigns/:id/scale`: apply `{ recommendationId, clientPct, earlyOverride?, ceilingOverride? }`
- `GET /campaigns/:id/cycles`, `GET /campaigns/:id/logs`: cycle log, override history, audit log
- `GET /campaigns/:id/creatives`, `PATCH /ads/:id`: creative leaderboard; tag angle, style and tone
- `GET /campaigns/:id/creative-brief`, `PATCH /brief-items/:id`: brief and item status tracker
- `GET /campaigns/:id/profile`, `POST /campaigns/:id/profile/insights/:kind`: scaling profile and pattern insights
- `POST /campaigns/:id/goal`: after the goal is reached, set a new target, maintain, or pause
- `GET /notifications`, `PATCH /me/notifications`, `PUT /me/angle-taxonomy`

## Design decisions worth knowing

- **Blank targets are calculated.** Target ROAS is 15% above the client's floor and at least 1.25× breakeven (1 / margin). Target CPA is the stricter of 85% of the max CPA and AOV / target ROAS. Target budget is target orders × target CPA, capped.
- **Verdict tiers are relative to the client's targets.** Strong is ROAS ≥ 1.5× target, good is ≥ 1×, and borderline means hold. "Declining" is ROAS down 10%+ week over week while frequency rises or most creatives are fatigued. A CPA above the client's target CPA drops the tier one step.
- **Scale steps follow the preference.** In percent, strong/good steps are 20/10 for conservative, 30/20 for moderate and auto, and 40/30 for aggressive. The cooldown is 5/4/3 days, or fitted to the timeline within 3-5 days.
- **The roadmap is honest about shortfalls.** If the cap is reached before the order target at current efficiency, it says so and states the CPA needed to close the gap.
- **Creatives needed** = fatigued + max(0, minimum − healthy − fatigued) + untested angles. The spec's sum would count a retired creative twice, once as fatigued and again in the gap.
- **Angle, visual style and tone are client tags** on each ad (`PATCH /ads/:id`). Meta doesn't expose them, and pattern analysis depends on them. Format and video length come from Meta; "UGC" is a client re-tag of a video.
- **`system_recommendation_pct` logs what the client was shown.** Gating (cooldown, blocks, cap) is re-checked on fresh data at execution time.

## Status

Built, following the spec's build order:

1. Monorepo
2. Prisma schema and migrations
3. Meta OAuth and encrypted tokens
4. Performance sync
5. Brief, roadmap and thresholds API
6. Creative Engine
7. Scaling Engine
8. BullMQ workers
9. Notifications

10-14. Dashboard, recommendation UI, cooldown override UI, creative brief tracker, and client scaling profile

**Next:** Railway deployment config, then Google Ads.
