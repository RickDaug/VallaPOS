# Back-End, Code, Data & Integrations

**Manager:** Kofi, Engineering Lead
**Severity counts:** S0 0 · S1 1 · S2 3 · S3 6

## Executive summary

The Back-End/Data/Integrations domain of VallaPOS is, on the whole, unusually disciplined: every server action carries "use server", webhooks read raw bodies before verifying distinct per-rail signatures, the payments capture path is compare-and-set with a @unique double-capture guard, and the vast majority of catch blocks are deliberate degrade-don't-crash no-ops rather than silent swallows. Three auditors surfaced 12 raw findings; after dedup (the CSP item was reported by two auditors) and source re-verification, 10 stand. There are no S0 issues and no active cross-tenant data leak — the tenant-isolation guard's blind-spot files were all confirmed businessId-scoped today. The headline concern is a doc-vs-reality drift: STATE.md claims CSP was moved to ENFORCED on prod, but source ships CSP_ENFORCE=false (report-only) and recon confirms prod still serves Content-Security-Policy-Report-Only. The one potential S1 is operational, not code: recon captured intermittent prod 503s on /{businessId}/register matching exactly the connection-ceiling PR #115 was written to fix — but whether the required Vercel pooled-connection env swap actually landed cannot be confirmed from source. Remaining items are resilience/observability polish: missing error/not-found boundaries outside the (app) group, an un-try/catch'd Upstash adapter, an unlogged desktop-checkout failure, and two lint/pin policy drifts.

## Coverage statement

Covered from source at C:/Users/RickD/AndroidStudioProjects/VallaPOS: all three webhook routes (payments/billing/desktop-license) — raw-body-before-verify, distinct secrets, 503/400/200 pattern; the payments capture path (sale-store, connect-store, billing-store) — tenant resolved from globally-unique Stripe ids, amount/currency re-verify, compare-and-set + @unique capture guard; env validation (env.ts) and Prisma singleton/tenant-backstop (db.ts, tenant-backstop.ts); the Redis secondaryStorage adapter (redis.ts); the middleware CSP block (root middleware.ts, re-read and confirmed CSP_ENFORCE=false at line 43); the tenant-isolation static guard (tenant-isolation.guard.test.ts) plus its three glob blind-spot files, each re-read and confirmed businessId-scoped; prisma schema datasource/pooling block; package.json deps and eslint.config.mjs rules (re-verified cross-env ^7.0.3 and no-explicit-any=warn); repo-wide error.tsx/not-found.tsx/global-error.tsx globs; and desktop-license/actions.ts (re-read the unlogged catch). I independently re-read every low/medium-confidence or shaky claim rather than trusting the auditor summary. Honest gaps: this is a static source review with NO live browser, NO Vercel dashboard/CLI access, and NO running DB. Therefore the intermittent-503 / pooling finding (recon #9) and the CSP-header-on-prod observation are asserted from recon's live captures, not re-confirmed by me — those are marked verified:false. CloudPRNT deviceToken handling I accepted from the auditor's grep (feature is unwired) without re-reading the route, also verified:false.

## Sign-off

I attest the Back-End, Code, Data & Integrations domain was covered from source: webhooks, payments capture/idempotency, tenant isolation (guard + its blind spots), env/DB/pooling config, Redis/auth degradation, error boundaries, and dependency/lint policy. Every surviving finding was re-read against the repo and severities corrected on manager review (the CSP item was de-duped and reconciled from a split S1/S2 down to S2 as documentation-drift-plus-defense-in-depth, not an active exploit; the desktop-checkout logging gap corrected S2->S3 as observability-only). No active cross-tenant leak, no unverified secret-handling defect, and no S0 was found in source. The single S1 and the two live-observed items are explicitly flagged verified:false and require live Vercel/browser verification the static review could not perform. — Kofi, Engineering Lead

## Findings (10)

#### S1 — Prod intermittent 503 on /{businessId}/register matches the exact connection-ceiling PR #115 was meant to fix — pooled-DB env swap not confirmed
- **Area:** reliability / db-connection-pooling
- **Auditor:** Yuki, the Log Hunter · **Confidence:** low · _unverified (auto-consolidated)_
- **Evidence:** `prisma/schema.prisma:15-26 documents url=DATABASE_URL as the POOLED Neon endpoint (host contains -pooler, pgbouncer=true) with directUrl=DIRECT_URL for CLI-only DDL — the PR #115 schema change is present. STATE.md's '2026-07-12 DB connection pooling (PR #115, OPEN)' entry states the fix ALSO requires an operator step (swap Prod+Preview DATABASE_URL in Vercel to the -pooler host + redeploy) that is not verifiable from source. Recon item 9 (live prod capture 2026-07-21, after STATE.md's 2026-07-19 anchor) independently observed intermittent HTTP 503 on /{businessId}/register RSC/POST that succeeds on retry — the connection-exhaustion signature.`
- **Impact:** If the Vercel env still points at Neon's direct non-pooled host, concurrent cashiers are capped at ~40-75 before 'too many connections', producing 503s at the register (a real money path) during busy periods — the precise failure PR #115 targeted, still reproducing live.
- **Fix:** Verify via Vercel CLI/dashboard whether the Production DATABASE_URL host contains '-pooler'/pgbouncer=true; if not, complete PR #115's env swap + redeploy, then re-run prisma/smoke-order-race.ts to confirm the ceiling is lifted.

#### S2 — STATE.md claims CSP was moved to ENFORCED on prod, but source ships CSP_ENFORCE=false (report-only)
- **Area:** security-control / documentation-code drift
- **Auditor:** Yuki + Ada (deduped) · **Confidence:** high
- **Evidence:** `middleware.ts:43 (repo root) 'const CSP_ENFORCE = false;' — a bare source constant, not env-gated — with lines 27,45-47 selecting the 'Content-Security-Policy-Report-Only' header until 'live-verified against the installed register PWA on a real device'. This contradicts STATE.md's 2026-06-25 '#77 CSP enforce (R-5): moved from report-only to ENFORCED... Verified live on prod.' Recon item 3 independently confirmed prod serves Content-Security-Policy-Report-Only.`
- **Impact:** Report-only is a deliberate, reasoned safe default (not an accident), so this is not an active exploit — but it is one layer of XSS mitigation that is NOT blocking in prod, and STATE.md asserts the opposite, so nobody is tracking it as an open gap and it can silently stay report-only indefinitely. Manager note: reconciled from Yuki's S1 / Ada's S2 down to S2 — defense-in-depth-plus-doc-drift, not a live breach.
- **Fix:** Correct STATE.md's #77 entry to say CSP is still report-only, and either finish the live-PWA verification and flip CSP_ENFORCE to true, or env-gate it with a tracked go-live checklist item so the doc/reality gap can't recur.

#### S2 — No error.tsx boundary outside the (app) route group — auth, marketing, blog, desktop-license buy, and pay routes fall to Next's unstyled error page
- **Area:** failure-modes / error-boundaries
- **Auditor:** Yuki, the Log Hunter · **Confidence:** high
- **Evidence:** `Repo-wide glob app/**/error.tsx returns only app/(app)/[businessId]/error.tsx; app/**/global-error.tsx returns nothing. No boundary exists at app root, nor under (auth) (sign-in/up, forgot/reset-password), blog, desktop, pay, or ~offline.`
- **Impact:** A render-time exception on sign-up/sign-in (first product impression) or the $99 desktop-license buy/download flow (a real money path) surfaces Next's default unstyled page with no 'Try again' recovery the way the businessId boundary provides — the user dead-ends.
- **Fix:** Add a root app/error.tsx and a global-error.tsx reusing the recovery pattern from app/(app)/[businessId]/error.tsx so every segment has a styled, actionable boundary.

#### S2 — Upstash Redis calls in the Better Auth secondaryStorage adapter have no try/catch — a live Redis blip becomes a hard auth failure instead of degrading
- **Area:** failure-modes / silent-degradation
- **Auditor:** Yuki, the Log Hunter · **Confidence:** medium
- **Evidence:** `src/lib/redis.ts:26-34 — get/set/delete call redis.get/set/del directly with no try/catch. createSecondaryStorage() degrades to null (in-memory) ONLY when the URL/token are unset at boot (env.ts); it does nothing for a live network/timeout error once configured. Upstash is confirmed live in prod for session/rate-limit storage.`
- **Impact:** A transient Upstash timeout/regional hiccup (or the called-out free-tier commands/day cap) makes an in-flight session/rate-limit read or write throw an unhandled error into the auth call, violating this codebase's otherwise-consistent 'degrade, never crash' philosophy; plausibly a contributor to the recon #9 intermittent 503s alongside the DB-pooling theory.
- **Fix:** Wrap each Upstash call in redis.ts in try/catch that logs and falls back to a no-op/miss, mirroring the boot-time degrade pattern already used in env.ts.

#### S3 — No not-found.tsx anywhere in the app — unmatched routes hit Next's generic 404
- **Area:** failure-modes / missing-page
- **Auditor:** Yuki, the Log Hunter · **Confidence:** high
- **Evidence:** `Repo-wide glob app/**/not-found.tsx returns nothing across the entire route tree (worktrees excluded).`
- **Impact:** Any typo'd URL, stale bookmark, or bad businessId slug not caught by app-group routing falls to Next's unbranded default 404 with no way back into the app.
- **Fix:** Add a root app/not-found.tsx styled with the rest of the site, linking back to / or /sign-in.

#### S3 — startDesktopCheckout swallows the Stripe Checkout-creation error with zero logging
- **Area:** failure-modes / observability
- **Auditor:** Yuki, the Log Hunter · **Confidence:** high
- **Evidence:** `src/features/desktop-license/actions.ts:22-24 — '} catch { return { error: "unavailable" }; }' has no console.error before returning the generic result (re-read in full).`
- **Impact:** This gates the $99 one-time desktop-license purchase (/desktop/buy). If Checkout creation fails once live (key rotation, Stripe outage, bad price id, rate limit) the buyer sees generic 'unavailable' and there is no server-side trace of why — pure observability gap, no data loss or broken degrade. Manager note: corrected from S2 to S3 (diagnosability only; the flow still degrades cleanly).
- **Fix:** Log the caught error (e.g. console.error("startDesktopCheckout failed:", err)) before returning { error: "unavailable" }, matching the webhook routes' logging discipline.

#### S3 — Tenant-isolation static CI guard's glob misses non-queries/actions files that hold tenant-model Prisma calls
- **Area:** db-integrity / defense-in-depth
- **Auditor:** Tomas, the Integration Tester · **Confidence:** high
- **Evidence:** `src/test/tenant-isolation.guard.test.ts:175-176 globs only src/features/**/queries.ts and src/features/**/actions.ts (plus app/**/route.ts). Tenant-model calls also live outside that glob: operator.ts:114 db.membership.findFirst, resolve-lines.ts:106 db.variation.findMany, manager-approval.ts:69 db.membership.findMany — all three re-read and CONFIRMED businessId-scoped today (operator.ts:115 where includes businessId; resolve-lines.ts:107 where:{businessId,...}; manager-approval.ts:71 where:{businessId,...}). No live leak.`
- **Impact:** A future edit dropping the businessId filter in any of these three files would ship silently past the guard that was built precisely to prevent cross-tenant leaks — same failure mode, just outside the scan surface.
- **Fix:** Widen the guard glob to include src/lib/*.ts and non-test src/features/**/*.ts files containing tenant-model calls (or enumerate them), then re-run to confirm zero new violations.

#### S3 — CloudPRNT deviceToken is an unregistered, unvalidated capability string (currently dormant/unwired)
- **Area:** integrations / token-scoping
- **Auditor:** Tomas, the Integration Tester · **Confidence:** medium · _unverified (auto-consolidated)_
- **Evidence:** `app/api/cloudprnt/[deviceToken]/route.ts:20-23 (per auditor) treats the opaque deviceToken AS the credential, scoped only by (businessId, deviceToken) string match, never checked against a DB-registered device row. Auditor grep found no UI code generating/persisting a deviceToken, and STATE.md #88 documents the queue as not-yet-durable Phase 2 — endpoint deployed but unwired. Not re-read by manager; accepted as dormant.`
- **Impact:** Near-zero today (nothing issues valid tokens). Once a device-registration UI is wired, a low-entropy or client-exposed token plus a guessable businessId (visible in authed URLs) could let an outsider poll/delete another business's print queue.
- **Fix:** When wiring the Devices UI, generate deviceToken server-side with >=128 bits entropy and persist a hash tied to businessId so the route validates ownership rather than trusting the URL pairing.

#### S3 — cross-env is the sole non-exact-pinned dependency, violating the stated exact-pin policy
- **Area:** dependency-pinning
- **Auditor:** Ada, the Code Reader · **Confidence:** high
- **Evidence:** `package.json:58 '"cross-env": "^7.0.3"' vs exact pins everywhere else (verified: '"next": "15.5.19"'). Used only in dev:local/build:local npm scripts, never shipped to runtime.`
- **Impact:** Low real risk (tiny dev-only shim) but inconsistent with the project's own policy and could admit an unreviewed cross-env 7.x patch into CI/build.
- **Fix:** Pin to exact `"cross-env": "7.0.3"`.

#### S3 — @typescript-eslint/no-explicit-any is 'warn' not 'error', undercutting the adjacent 'no silent escape hatches in money code' intent
- **Area:** lint-strictness
- **Auditor:** Ada, the Code Reader · **Confidence:** medium
- **Evidence:** `eslint.config.mjs:15-16 — '"@typescript-eslint/ban-ts-comment": "error"' directly above '"@typescript-eslint/no-explicit-any": "warn"' under the 'No silent escape hatches in code that handles money' comment. A warn doesn't fail CI, so an 'any' could land in a money path. Currently dormant (npx eslint . reports 0 warnings).`
- **Impact:** A future PR could introduce `any` in a checkout/payment file and CI would only warn, not block, undermining the stated policy right above the rule.
- **Fix:** Bump no-explicit-any to 'error', or scope an error-level override to money directories (register/, payments/, billing/, orders/, cash-drawer/).

