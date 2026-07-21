# Functionality & User Flows

**Manager:** Mara, QA Lead
**Severity counts:** S0 0 · S1 1 · S2 5 · S3 2

## Executive summary

Functionality & User Flows squad reviewed VallaPOS's money paths (checkout, refund/void, cash drawer, time tracking) and the newcomer/navigation surfaces (sign-up, onboarding, routing, error/404 boundaries, legal pages) via static source review. Eight findings survive verification after dedupe: one S1 money-integrity bug, five S2, and two S3. The headline risk is a partial-refund replay hole (S1): the client mints a fresh idempotency key on every invocation, so a manual retry after an ambiguous/lost response (a failure mode RECON observed live in prod) can issue a SECOND real reversing payment — a double-refund — because the PARTIALLY_REFUNDED status is not terminal and the new key defeats the only replay guard. This matches the known-open refund idempotency bug already logged in project memory. The rest cluster into (a) two check-then-create TOCTOU races (openDrawer S2, clockIn S3) lacking DB-level partial-unique constraints, and (b) a set of routing/error-surface gaps: no branded 404 anywhere, no root/pre-auth error boundary, and legal pages (Privacy/Terms/DMCA) reachable only via client-side hash routes with no crawlable URL. The onboarding lane itself is unusually well hardened by prior audit rounds; the surviving UX gaps are a missing sign-up consent link, and no direct receipt link from the post-sale success screen.

## Coverage statement

Domain covered: transactional correctness and concurrency of the money paths (refund/void idempotency and row-locking in src/features/orders/actions.ts + OrderActions.tsx; cash-drawer open/close in src/features/cash-drawer/actions.ts; clock in/out in src/features/employees/actions.ts), the Prisma schema constraints backing them (prisma/schema.prisma CashDrawerSession/TimeEntry), the full route tree under app/ (not-found/error/loading boundaries, notFound() call sites, legal-page routing), and the newcomer flow (sign-up, onboarding checklist, register empty/success states, receipt reachability). Every finding below was re-read at source and confirmed; no auditor claim was accepted on trust. Honest gaps: this was a STATIC review with NO live browser and NO running database — the concurrency races (openDrawer, clockIn) and the refund double-submit are reasoned from code + schema, not reproduced against a live Postgres/Neon instance or a real network-failure injection; severities reflect that the triggering conditions (concurrent devices, lost HTTP response) are plausible and, for the refund case, already witnessed in prod per RECON, but not empirically re-triggered here. We did not exhaustively read every internal helper in the tender/tip/pricing/resolve-lines modules (spot-checked via call sites only).

## Sign-off

I attest the Functionality & User Flows domain — money-path transactional correctness and the newcomer/navigation surfaces — was fully covered by static source review. All three auditors' findings were deduped (one 404 duplicate merged, its severity corrected S3→S2) and every surviving finding was independently re-read at source and confirmed true. The one caveat on completeness is the absence of a live browser and running DB, disclosed in the coverage statement; within static-analysis limits the domain is signed off. — Mara, QA Lead

## Findings (8)

#### S1 — Partial refund is not idempotent against a client retry — an ambiguous/lost response can double-refund a customer
- **Area:** orders / refund flow
- **Auditor:** Rex, the Breaker · **Confidence:** high
- **Evidence:** `OrderActions.tsx:57 mints a FRESH crypto.randomUUID() inside run() on every invocation, including a manual retry after the promise rejects (catch at 66-71 resets inFlight and re-enables the button). In orders/actions.ts the only replay guard for refundOrder is priorReversalResult(...,clientUuid) (line 244), which matches on the exact refund:<clientUuid> tag stamped in Payment.processorRef. Unlike void/full refund (safe because status flips to terminal VOIDED/REFUNDED, checked at 198/247 via SETTLED=new Set(['VOIDED','REFUNDED']) at 132), a PARTIAL refund leaves the order PARTIALLY_REFUNDED, which is NOT in SETTLED. A second partial call carrying a NEW clientUuid is blocked by neither guard; the FOR UPDATE row lock (lockOrderRow, 151-153) only serializes CONCURRENT requests, it does not dedupe two SEQUENTIAL retries with different keys. planPartialRefund (line 270) then computes a fresh valid reversal against the remaining balance.`
- **Impact:** RECON item 9 observed exactly this ambiguous-failure pattern live in prod (intermittent 503 on register RSC/POST that then succeeded on retry). If it hits a partial-refund action — request commits but the HTTP response is lost — the manager sees a generic error toast and, re-clicking Refund with the same amount, issues a SECOND real reversing Payment for up to the remaining balance. Real money-integrity bug (double-refunds the customer / miscounts the till). Matches the known-open refund idempotency bug in project memory (vallapos-qa-remediation.md).
- **Fix:** Generate the clientUuid once when the partial-refund confirm dialog opens (not inside run() on every call), or derive the server idempotency key from durable inputs (businessId+orderId+amountCents+short time bucket), or require the client to reconcile against the prior attempt's stored result before a second submission.

#### S2 — openDrawer has a check-then-create TOCTOU race — two concurrent opens can create two OPEN cash-drawer sessions for one business
- **Area:** cash-drawer flow
- **Auditor:** Rex, the Breaker · **Confidence:** high
- **Evidence:** `cash-drawer/actions.ts:44-57 openDrawer does findFirst({where:{businessId, closedAt:null}}) then an unconditional create, with NO transaction and NO DB-level uniqueness. prisma/schema.prisma:552-565 CashDrawerSession has only @@index([businessId]) — no partial unique index enforcing at most one row per business with closedAt IS NULL (verified by reading the model). The UI's only guard is React useTransition pending (DrawerManager.tsx), a same-tab guard that does not stop two devices/tabs opening near-simultaneously in the shared-terminal team-operator model. Note the codebase fixes this exact hazard with a useRef guard in OrderActions.tsx:39-42 but has no equivalent here.`
- **Impact:** Two open sessions break the single-open-session invariant that getCashCollectedSince and the Z-report reconciliation implicitly assume. closeDrawer looks up by id so it can close one, but cash-collected-since windows can split/duplicate cash-window accounting or orphan a session that never reconciles — undermining the till-integrity guarantee the rest of the money path (checkout, refund's assertOpenDrawerForCash) depends on.
- **Fix:** Add a Postgres partial unique index on CashDrawerSession(businessId) WHERE closedAt IS NULL so the DB rejects a second concurrent open, or wrap check+create in a transaction with a row lock — mirroring the settledByPaymentId/order-number guards used elsewhere.

#### S2 — No app-level not-found.tsx anywhere — every 404 path (including cross-tenant businessId probes) falls through to Next's unbranded default
- **Area:** routing / error surfaces
- **Auditor:** Sam, the Completionist (dedup: also filed by Priya at S3; merged, severity corrected up) · **Confidence:** high
- **Evidence:** `find app -iname 'not-found*' returns zero results anywhere in the repo (verified). Yet notFound() is called from 11 user-reachable sites incl. app/(app)/[businessId]/layout.tsx (a ForbiddenError from a cross-tenant access attempt renders 404 here), orders/products/reports/register/settings/drawer/floor pages, orders/[orderId]/receipt (bad orderId), and blog/[slug] (bad slug). Any mistyped URL hits the same generic boundary. The authenticated shell has its own error.tsx + loading.tsx but no not-found.`
- **Impact:** A mistyped URL, stale/bookmarked link, bad order/business id, or a worker/attacker probing another tenant's businessId all land on Next's bare '404 | This page could not be found' — no branding, no nav, no back-to-home/sign-in. For a POS whose staff routinely share and bookmark deep links (receipt URLs, business-scoped URLs), this is a routine path, not an edge case.
- **Fix:** Add a branded root app/not-found.tsx (links to / and /sign-in) and optionally a (app)/[businessId]/not-found.tsx that links back to /{businessId}/register.

#### S2 — No root/pre-auth error.tsx boundary — an uncaught exception on marketing, auth, or blog shows Next's raw default crash screen
- **Area:** routing / error surfaces
- **Auditor:** Sam, the Completionist · **Confidence:** high
- **Evidence:** `find app -iname error.tsx returns exactly one file: app/(app)/[businessId]/error.tsx (verified). Nothing at app/error.tsx, app/(auth)/error.tsx, or app/blog/error.tsx.`
- **Impact:** Any render-time exception on /, /sign-in, /sign-up, /forgot-password, /reset-password, /blog, /blog/[slug], /desktop/license, or /pay/success bubbles to Next's default unstyled error UI (in prod, a generic client-side-exception message) instead of a friendly boundary with Try again / Go home — unlike the authenticated app, which already has that pattern.
- **Fix:** Add a root app/error.tsx client component mirroring app/(app)/[businessId]/error.tsx so pre-auth and marketing/blog surfaces get the same graceful recovery.

#### S2 — Legal pages (Privacy/Terms/Disputes/Do-Not-Sell/DMCA) have no real URLs — direct navigation to /privacy 404s
- **Area:** routing / legal-page discoverability
- **Auditor:** Sam, the Completionist · **Confidence:** high
- **Evidence:** `find app for privacy*/terms*/dmca*/disputes* returns nothing (verified). All five legal docs exist only as client-side hash-routed views inside / (MarketingSite.tsx keyed off location.hash against the LEGAL dict in marketing-content.ts), reachable only via /#/privacy etc. Per RECON item 4, prod /sitemap.xml lists only /, /sign-up, /sign-in — the legal docs have no crawlable URL.`
- **Impact:** Anyone who types, bookmarks, or is sent vallapos.com/privacy, /terms, /dmca directly (the URL shape a payment processor, app-store reviewer, or compliance auditor tries first) gets the unbranded default 404, not the policy. The docs also cannot be indexed or deep-linked — only the JS-rendered SPA fragment is reachable, and only after / fully loads.
- **Fix:** Add thin real Next.js routes (app/privacy/page.tsx etc.) rendering the same LEGAL content (best for SEO/crawlability), or at minimum a client redirect so /privacy resolves to /#/privacy instead of 404ing.

#### S2 — Sign-up form has no Terms of Service / Privacy Policy link or consent control
- **Area:** onboarding / sign-up
- **Auditor:** Priya, the New User · **Confidence:** high
- **Evidence:** `app/(auth)/sign-up/page.tsx (read in full, lines 1-161) contains no reference to Terms, Privacy, or any consent control before authClient.signUp.email(...) and createBusiness(...). The only footer link is Sign in (line 151-156). Grep confirmed the legal copy lives only in marketing-content.ts as hash-routed sections, never linked from (auth)/sign-up or the app shell.`
- **Impact:** A first-time merchant creates an account and a business — a real, potentially paid, financial record-keeping relationship handling payment/tax/customer data — without ever being shown or asked to accept Terms or a Privacy Statement. A genuine compliance and trust gap, and a small fix relative to the polish invested elsewhere in this flow.
- **Fix:** Add 'By creating an account you agree to our Terms and Privacy' with links to the legal content (ideally the real crawlable routes proposed above) directly under the sign-up submit button.

#### S3 — clockIn has the same check-then-create TOCTOU race (lower stakes)
- **Area:** employees / time tracking
- **Auditor:** Rex, the Breaker · **Confidence:** medium
- **Evidence:** `employees/actions.ts:368-377 clockIn does findFirst({clockOutAt:null}) then create with no transaction. prisma/schema.prisma:216-228 TimeEntry has only @@index entries — no partial unique constraint on (businessId, membershipId) WHERE clockOutAt IS NULL (verified). Same shape as the openDrawer race but for time entries. (clockOut at 387+ is safe — it uses an updateMany scoped by clockOutAt:null so the loser updates 0 rows.)`
- **Impact:** A rapid double-tap or two open tabs could open two concurrent TimeEntry rows for one member, skewing payroll/timesheet hours. Not a direct money-safety issue (payroll integration is HELD per project memory) but worth fixing alongside the drawer race since it's the identical pattern.
- **Fix:** Same as openDrawer: partial unique index on TimeEntry(businessId, membershipId) WHERE clockOutAt IS NULL, or transaction + row lock.

#### S3 — Post-sale success screen has no link to view/print/email the actual receipt
- **Area:** first sale / receipt
- **Auditor:** Priya, the New User · **Confidence:** high
- **Evidence:** `Register.tsx:603-643: the inline 'Sale complete' success card renders totals and a single 'New sale' button (637-639) — no link to the printable /{businessId}/orders/{orderId}/receipt page where Print/Email live (ReceiptActions.tsx). The receipt is only reachable by navigating to Orders and opening the order (a path that exists, so this is friction, not a hard dead end).`
- **Impact:** A first-time merchant who just rang up their first sale and wants to hand the customer a receipt has no direct path from the success screen — they must guess to go to the Orders tab, find the order, and open it. Minor friction at exactly the moment the checklist is celebrating 'you're live.'
- **Fix:** Add a 'View receipt' link/button on the post-sale success card pointing at /{businessId}/orders/{order.id}/receipt alongside 'New sale'.

