# VallaPOS — Project State

> **Read this first.** This is the single source of truth for what exists, what's wired, and what's next. Update it as work lands.

_Last updated: 2026-06-24 — see the **"2026-06-24 — team operator model + …batch"** section just below for the newest work (team PIN-lock #54–#56 + the #57–#60 feature batch; 339 tests green). Older history follows. Phase 1 + full Phase 2 + two security-hardening batches merged. **2026-06-22:** fixed a live Vercel deploy break — an invalid optional `UPSTASH_REDIS_REST_URL` in Vercel was crashing every build; `env.ts` now degrades invalid optional Upstash vars to undefined (in-memory fallback) instead of throwing (#46, Vercel-deploy-verified). Added the missing R-3 concurrent-race idempotency test (#47). Confirmed the re-audit batch #44 already shipped **R-2/R-3/R-4/R-6/R-8** (this file's old "Still open" listed them as open — corrected below). **219 tests green; `npm audit` = 0.** **GitHub Actions billing: RESOLVED 2026-06-26** — the `quality` CI gate runs again (it was billing-suspended for most of June). Earlier (2026-06-14): security audit (#38) → fixes #39–#42, #40; re-audit hardening batch #44; #37 Radix modifier-picker; #21/#23/#24/#26/#28/#29/#30/#31/#32/#34. Open PRs: **#45** (R-1 SW cache, awaiting human offline sign-off)._

## 2026-06-25 — 5-perspective QA audit + fixes (all merged)

Ran a multi-lens QA audit (Principal Eng / QA Lead / POS-domain / UX / casual user) against `main` as a **pre-launch MVP**. Verdict: **~76/100, "strong foundation, ship-to-pilot after a few fixes"** — the money engine is correct (server-authoritative, integer cents, per-line tax summed, idempotent, refund/drawer accounting sound), but **nothing had ever been verified live** and a few real gaps existed. Fixes fanned out (4 agents) and merged:
- **#45 (R-1, HIGH) — MERGED.** Service worker no longer caches authed `(app)/[businessId]/**` pages (a `NetworkOnly` matcher) and **purges the page caches on sign-out** — closes the shared-terminal cross-user cache leak. Independently code-reviewed as safe (no PWA/offline-queue breakage). _Still wants the long-standing human OFFLINE click-through to confirm live._
- **#74 (offline price drift, HIGH) — MERGED.** Replayed **offline** sales now record the **quoted** price (captured in an encrypted queue snapshot) instead of recomputing from the possibly-changed current catalog. **Deliberate, signed-off trust relaxation:** offline replay trusts client unit prices/modifier deltas ONLY; tax (recomputed from snapshot), order total (server-derived), modifier linkage, tenant scope, and idempotency stay server-authoritative. **Online checkout is wholly unchanged / still strict.** +15 tests.
- **#72 (unverified tenders, MED) — MERGED.** Z-report + CSV gain a **"Payments by tender"** breakdown labeling CASH *verified (in-drawer)* vs QR/Other *unverified (operator-confirmed, no drawer/PSP evidence)*, with a "Unverified collected" subtotal + amber callout. Detection half; a **manager-approval gate at checkout** for unverified tenders is the recommended prevention follow-up (touches money path + permissions → own PR).
- **#73 (no E2E, HIGH gap) — MERGED.** First **Playwright** smoke harness (`@playwright/test@1.61.1`, `npm run test:e2e`): sign-in → operator-lock bootstrap → ring up the seeded burger → cash checkout → receipt assertions, plus a bad-password test. Excluded from the vitest run. **Not yet run live** — needs `npm run db:seed` + a running app/`E2E_BASE_URL` + `npx playwright install chromium`. This is the durable answer to "nothing is verified live."

**Audit items still open:** activate Upstash (rate-limit/PIN-throttle is in-memory on serverless until set — HIGH), CSP enforce-mode w/ nonces (still report-only — held: PWA-breaking-risk, needs live verify), and **actually run the live/E2E pass** (harness now exists). ⚠ **Env note:** the dev box hit 100% disk mid-session (likely the in-progress SSD clone) — freed via stale-worktree + cache cleanup; watch it.

## 2026-06-24 — team operator model + register/security/payments/email batch (all merged)

**Shared-terminal team model (#54/#55/#56, migration `pin_staff_permissions` applied to Neon):**
- **#55 Phase 1** — accountless **PIN-only staff** (`Membership.userId` now nullable + `name` + `permissions String[]`, additive migration, backfilled from role presets) + capability-based permissions (`src/lib/capabilities.ts`: `can(role, permissions, cap)`, OWNER all-access). Actions: `addStaffMember`, `updateMemberName`, `setMemberPermissions` (OWNER-only). Reports/drawer/timesheets tolerate accountless members.
- **#56 Phase 2** — the **operator lock**: device stays signed in (tenant gate) but the app is LOCKED until a worker enters their PIN (the "active operator"). HMAC-signed httpOnly per-business cookie (`src/lib/operator.ts`) never trusted alone — `getActiveOperator` re-loads the membership from the DB every call (revoked operator stops instantly). `requireCapability` / `pageHasCapability` (`src/lib/operator-guard.ts`) gate checkout, tabs, refund/void, drawer, catalog, settings by the **operator's** capability; the operator is the `cashierId` on their sales. Re-locks after each sale + on idle.
- **#54** — split-settle made concurrency-safe: `settleTab` asserts the `updateMany` count equals the planned line count inside the tx (else the payment rolls back too), so two staff settling the same tab can't over-collect the till.

**Feature batch — 4 parallel agents, all merged to `main`:**
- **#57 Register UX** — mobile cart Radix **Sheet** + "View cart" bar, per-device **Favorites** tab (localStorage, per-business), grid⇄list **density toggle**. Client-only, no schema, no new deps; pure `register/preferences.ts` (+8 tests). _Wants a browser/mobile pass._ (Modifier picker → Radix Dialog was already done in #37.)
- **#58 Phase 3 payments groundwork** — `docs/PAYMENTS.md` (PaymentProvider design, capability matrix, rail mapping, **proposed-not-applied** schema, rollout) + **inert** scaffold `src/features/payments/*` (cash provider, registry, `PAYMENTS_V2_ENABLED` flag default OFF). Zero live-path diff, no schema (+19 tests). _8 decisions pending — see below._
- **#59 Security** — **R-7**: AES-GCM (Web Crypto) encryption of the offline checkout queue at rest; key is a non-extractable CryptoKey in its own IndexedDB; legacy plaintext entries still replay, tampered ones drop gracefully; sign-out wipes the key. **R-5 (reporting half)**: `app/api/csp-report` endpoint + `report-uri`/`report-to`/`Reporting-Endpoints` header. CSP **stays report-only** (enforce/nonces still a separate human-verified PR). Zero new deps (+14 tests). _Wants a browser pass for offline + CSP._
- **#60 Receipt email** — Resend wired behind the #11 scaffold; `resend@6.14.0` pinned. `RESEND_API_KEY` + `RECEIPT_FROM_EMAIL` **optional** (degrade like Upstash: unset = unchanged `email_not_configured`, build never throws). Pure renderer/validation in `receipt-email.ts`; typed result union; receipt-page "Email receipt" UI (+19 tests). _Dormant until you set the env vars._ Did NOT touch Better Auth email verification (M-3).

**Manual / "Other" tender (#62, merged — first real step off the #58 groundwork):** the register tender step gained a **Cash | Other** toggle; "Other" records a sale paid outside the app (external card reader, check, transfer) at the server total with **no PCI surface, no tender/no change**, an optional reference note. Reuses the existing `PaymentMethod.MANUAL` enum + `Payment.processorRef` — **no schema change/migration, no new dep**. New shared `paymentMethodLabel()` (`MANUAL → "Other"`) used by the printable receipt, orders list, and email renderer; flows through the offline queue automatically. _Wants a browser pass (ring up → Other → Record → receipt; confirm offline queue)._

**QR rail (#64, merged; migration `20260624204400_qr_pay_config` applied to Neon):** a **confirm-based, merchant-configured** scan-to-pay tender — the OWNER sets their own payment handle/link in Settings (PIX key, UPI id, Venmo, PayPal.me, a payment-link URL; `Business.qrPayEnabled/qrPayLabel/qrPayValue`, additive nullable cols), the register's tender step becomes **Cash | QR | Other** (QR only when configured), shows the value as a QR (`qrcode.react@4.2.0`, pinned) + amount + optional reference, and the cashier confirms receipt → `method=QR`. **No PSP, no webhooks, no PCI surface**; market-agnostic; flows through the offline queue + receipts. Checkout generalized cash→non-cash (QR/MANUAL capture the server total, no tender/change, reference in `Payment.processorRef`). Settings schema extracted to `settings/schema.ts`. _Real **processor-backed dynamic QR** (per-order amounts, webhooks) still needs the rail/market + PSP decision._

**UI polish pass (#66–#71, merged) — "all of the above" UI request:** the app was already strong on a11y (global `:focus-visible`, 44px touch law, `prefers-reduced-motion`) + OKLCH design system, so this was *enrichment*. **#66** added a dependency-free, accessible **toast system** (`src/components/ui/toast.tsx` + pure `toast-reducer.ts`; `ToastProvider` at the app root, `useToast()`, `aria-live`/`role=alert`) as the app's feedback channel, adopted in Settings. Then a 4-agent per-screen fan-out adopted toasts + added subtle micro-interactions (press/hover feedback, polished empty/pending states) using existing tokens only — **#67** catalog/Products, **#68** cash-drawer + order refund/void + receipt-email (extracted pure `describeRefundVoidResult`, +6 tests), **#69** restaurant tabs + floor (feedback/styling only — drag math + settlement untouched), **#70** employees/operator (wrong-PIN shake, reduced-motion-safe). **#71** added an "Offline sales synced" toast on queue drain in the Register. No schema, no new deps (beyond #64's qrcode), no shared-primitive edits. _Wants a browser pass to eyeball the toasts + interactions._

**Post-audit follow-through (2026-06-25, all merged) — every audit HIGH now closed + live-verified:**
- **Live E2E verification (#73 harness, fixes #76):** ran the Playwright smoke against **production** → **2 passed** (sign-in → operator-lock → register → modifier picker → cash checkout → receipt; + bad-password). First-ever live end-to-end pass — closed audit #1. Prereq: `npm run db:seed` + `E2E_BASE_URL=https://valla-pos.vercel.app npm run test:e2e` (chromium). #76 fixed two harness-only selector/timeout bugs (the app was correct).
- **Upstash ACTIVATED (audit #3):** rate-limit + Better Auth `secondaryStorage` is LIVE in Prod (DB `unbiased-gorilla-154222.upstash.io`, us-east-1). The Vercel vars were empty placeholders; set real creds for Prod+Preview + redeployed; **verified DBSIZE 0→5** after sign-ins. Gotcha logged: Vercel **Sensitive** vars read back empty via `vercel env pull` (false negative) — verify functionally. See [[vallapos-upstash-empty-vars]].
- **#77 CSP enforce (R-5):** moved CSP from report-only to **ENFORCED with per-request nonces** via `middleware.ts` + pure `src/lib/csp.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, **no `unsafe-inline` on scripts**; styles keep `unsafe-inline` — inline style attrs can't be nonce'd; report endpoint kept). next-themes script gets the nonce. **Verified live on prod**: enforced header + nonce on all 25 inline scripts + the browser E2E passed under it.
- **#78 manager-approval gate for unverified tenders (prevention half of #72):** new capability `approve_unverified_tender` (OWNER/MANAGER preset). At checkout, QR/MANUAL by a non-holder (cashier) requires a **manager PIN, verified server-side** (scrypt + throttle, tenant-scoped, attribution stays the cashier); owners/managers ring with no friction; CASH never gated; offline replays exempt. _Known soft-control tradeoff: the offline-replay exemption (`priceSnapshot.quoted`) is forgeable by a crafted payload — same insider vector as #74; #72's Z-report still records every unverified tender. Existing MANAGER members need a permissions re-save to skip the prompt (owners always work)._

**Suite: 473 tests green on `main`** (279 → +194; recent: #77 CSP +9, #78 manager-gate +20, peripherals groundwork #83/#84 +62). Plus the Playwright E2E harness (runs separately via `npm run test:e2e`, live-green against prod). CI `quality` is green again — Actions billing was resolved 2026-06-26 (verified passing in ~1m26s on `main`); Vercel deploys ran on each merge.

**Audit aftermath — all 4 HIGHs closed.** Remaining (lower priority): the manager-PIN *cashier* prompt path isn't E2E-covered (seeded user is an owner); **rotate the Upstash token** (it was pasted into a session transcript). Optional: tighten CSP `connect-src` from `https:` to `'self'` after watching the report endpoint; processor-backed payments still await the 4 #58 decisions.

## 2026-06-26 — custom-domain auth fix + peripherals/hardware groundwork (all merged)

**#81 — custom-domain sign-in fix (prod bug).** Sign-in on the custom domain **`vallapos.com`** failed with "Failed to fetch". Cause (reproduced headless): the auth client hardcoded `baseURL = NEXT_PUBLIC_APP_URL` (the `*.vercel.app` origin), so on `vallapos.com` auth fetches went **cross-origin → CORS-blocked**; `auth.ts` `trustedOrigins` was pinned to that single origin too. **Fix (domain-agnostic):** `auth-client.ts` now uses the **current page origin** (`window.location.origin`) → same-origin fetch, no CORS; `auth.ts` `trustedOrigins` now includes the custom domain **and** the `.vercel.app` domain. **Re-verified live** — headless sign-in on `vallapos.com` now reaches the register. _Cleanup TODO (not a bug): pick ONE canonical domain (likely `vallapos.com`), 301-redirect the other, and set `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` to it — avoids dual per-domain session jars._

**Peripherals / hardware groundwork (#82/#83/#84) — INERT, nothing wired into the app yet** (mirrors the `src/features/payments` scaffold pattern). Target: **Android / desktop Chrome / Windows (NOT iOS)** + **Epson/Star** thermal printers, cash drawer, barcode scanner.
- **#82 `docs/PERIPHERALS.md`** — `DeviceManager` + transport-adapter architecture + a 3-phase roadmap: **P1** pure-browser WebUSB Epson/Star ESC/POS print + drawer-kick + (free) HID scanner; **P2** network **CloudPRNT/ePOS** + capability auto-detect; **P3** local bridge (QZ Tray) and/or native shell for true zero-touch.
- **#83 `src/features/peripherals/escpos.ts`** — pure, **spec-verified** ESC/POS formatter (init/align/bold/size, line items + totals, **QR** block, **paper cut**, standalone **`drawerKick()`**) + structural mappers from the app's `OrderReceipt`/checkout `Receipt`. Hardware-free, +33 tests. _Limitation: non-ASCII transliterates to `?` (code-page selection deferred)._
- **#84 `src/features/peripherals/{types,registry,device-manager,flags}.ts`** — inert `DeviceManager`/transport TYPE contracts + Epson (`0x04b8`) / Star (`0x0519`) USB device registry with `identifyDevice()` 3-tier fallback (exact PID → vendor brand+safe caps → generic ESC/POS) + default-OFF `PERIPHERALS_V2_ENABLED`. +29 tests.

**Key verified caveats (shape the whole feature):** (1) a browser **cannot silently scan hardware** → the honest promise is "add a device once (one permission click) → auto-reconnect + auto-configure after", NOT zero-clicks-ever; true zero-touch needs a local bridge or native shell. (2) On **Windows, WebUSB fights the OS print driver** (needs a WinUSB/Zadig swap) → **CloudPRNT is the better Windows path**. (3) **HTTPS→HTTP mixed content** blocks an HTTPS POS from calling a printer's plain-HTTP LAN endpoint → **Star CloudPRNT / Epson Server-Direct (printer-polls-the-server)** is the robust network transport. Barcode scanners are HID keyboards (work today, zero integration); the cash drawer rides the printer's RJ11 kick port.

**Phase 1 needs real hardware** — the live transport adapter + a Settings "Devices" screen + wiring `drawerKick()` to cash checkout must be built/tested against an actual Epson/Star unit, and the registry's product IDs confirmed on-device. Right place to pause blind work.

**Payments — decisions needed before a real integration (#58):** (1) ~~QR rail + first market~~ — a confirm-based merchant-configured QR shipped #64; a **processor-backed** dynamic QR (Stripe Payment Links US vs regional SPEI/CoDi MX, PIX BR, UPI IN) still needs the call; (2) Stripe Terminal vs Connect; (3) fee/monetization model; (4) native shell RN vs Capacitor (gates ALL card-present). Plus: ~~generic "Manual/Other" tender~~ (✅ #62); PaymentIntent record for cash too or async-only? confirm cards never queue offline; webhook route (`app/api/payments/webhook`) + Stripe secret.

## Restaurant mode (MERGED #50; migration applied to Neon) + follow-ups
Restaurant mode shipped in **#50** and the **`20260623043550_restaurant_mode_floor_tabs` migration is applied to Neon** (via `prisma migrate deploy`). Follow-ups merged: **#51** persists the cashier on store sales (R-11) + keeps the floor view live (15s visible-tab refresh); **#52** adds a "Sales by cashier" Z-report table. **254 tests green.** Still wants a human browser pass of the full restaurant flow (mode → floor setup → open tab → split-settle) and #45 (SW cache) sign-off. Original feature summary below:

## Restaurant mode (feature detail)
A full dual-mode upgrade: a per-business **Store vs Restaurant** switch (`Business.mode`, OWNER setting), **fullscreen** (manifest `display:fullscreen` + a Fullscreen-API toggle button beside the theme toggle), and in Restaurant mode a **dining-room floor plan + open tabs with per-seat split checks**.
- **Schema (additive migration `20260623043550_restaurant_mode_floor_tabs`, NOT yet applied to Neon):** `BusinessMode`/`TableShape` enums, `FloorRoom`, `FloorTable` (canvas x/y/w/h, seats, shape), `OrderTable` join (a tab seated at 1+ tables = merge), `OrderLine.seat` + `OrderLine.settledByPaymentId` (per-seat split settlement), `Payment.settledLines`. All nullable/defaulted so STORE businesses are untouched. **⚠ Run `! npx prisma migrate dev` from this branch before testing tabs/floor live.**
- **Floor editor** (`src/features/floor/*`, Settings → Floor plan, MANAGER+): multi-room, drag-to-move + corner-resize on a fixed canvas (native pointer events, **no new dep**), shapes/seats/labels, quick-add, 0–100 table cap, 3-step empty-state. 
- **Open tabs** (`src/features/tabs/*`): `/floor` service view (status-colored table map, tap to open/view) → `/floor/[orderId]` table detail. Order grouped **by seat** (Shared + 1..N), add items (modifier picker) to a seat, qty/remove/move-seat, **merge/transfer** tables, **settle whole table or split by seat** (cash + tip via the NumberPad). A tab is an `OPEN` order; it closes to `PAID` when every line is settled, freeing the table. Money stays server-authoritative (shared `register/resolve-lines.ts`; `tabs/tab-math.ts` reconciles per-line tax exactly).
- **Tests:** +33 (tab-math 13, tab actions 12, floor schema 8); tenant guard extended to floorRoom/floorTable. **252 tests green; typecheck + lint + build green.** Built in verified layers (see `docs/RESTAURANT_MODE_PROGRESS.md`). **Still needs:** the migration applied + a human browser pass (set Restaurant mode → build a floor → open a tab → split-settle).

## Where we are

The original prototype was replaced with a restructured foundation (Phase 0, PR #1). **Phase 1 is complete and live on Neon.** Merged to `main` (newest first): seed sample modifiers (#19), cart modifiers + per-line tax (#18), cash-drawer session (#16), STATE refresh (#15), Better Auth audit (#14), PWA + offline queue (#13), integration tests (#12), receipt view + email scaffold (#11), facelift/design-system (#8), order-number race fix (#9), RSC CVE fix (#10), CI quality gate (#7), Vitest suite (#6), Orders + Z-report (#5), Settings + tax-inclusive pricing (#4), Products CRUD (#3), MVP core spine (#2). The full "ring up a sale" loop — auth + business bootstrap, route guards, catalog + modifiers, server-authoritative cash checkout, receipts, cash-drawer reconciliation, offline queue — is built and **integration-green on main** (typecheck + lint + **104 tests** + build).

**2026-06-13 batch (all merged):**
- **#11** order receipt view (printable, tenant-scoped) at `/[businessId]/orders/[orderId]/receipt` + credential-free email scaffold (`RESEND_API_KEY`-gated; `emailReceipt` returns `email_not_configured` until a provider is wired — **parked by request**).
- **#12** tenant-isolation + checkout-action tests (Prisma mocked via `src/test/server-only-stub.ts`); suite 23 → 45.
- **#13** Serwist service worker (`app/sw.ts`) + installable manifest/icons + IndexedDB offline checkout queue (`src/lib/offline/`), replays on reconnect via `clientUuid` idempotency. _Verified by build emission, not yet a live browser offline session._
- **#14** `docs/BETTER_AUTH_AUDIT.md`: ran `@better-auth/cli@1.2.8 generate` vs schema — **no auth-breaking discrepancies**; optional cosmetic `@@map` deferred.
- **#16** cash-drawer session + reconciliation (see section below).
- **#18** cart modifiers + per-line tax (see section below).
- **#19** seeds sample burger modifier groups.

**In flight:** **#20** — seed a real OWNER login on the demo business (see "Test login" below); **#17** — this STATE refresh.

## What exists now

### Docs (the "expectations", rewritten)
- `README.md` — honest overview + quick start
- `docs/PRD.md` — product requirements, personas, scope
- `docs/ARCHITECTURE.md` — stack, structure, multi-tenancy, offline, dependency policy
- `docs/ROADMAP.md` — MVP → v1 → v2
- `STATE.md` — this file

### Foundation (scaffolded, not yet feature-complete)
- `prisma/schema.prisma` — full multi-tenant model: Business, Membership/Role, Category → Item → Variation → ModifierGroup → Modifier, Order/OrderLine/Payment, CashDrawerSession, plus Better Auth tables. **Money stored as integer cents; tax as basis points.**
- `src/lib/env.ts` — zod-validated environment variables (fails fast on misconfig)
- `src/lib/db.ts` — Prisma singleton
- `src/lib/auth.ts` / `src/lib/auth-client.ts` — Better Auth server + client config (scaffold)
- `src/lib/tenant.ts` — `requireMembership()` choke point for tenant isolation + role gating
- `src/lib/money.ts` — integer-cents money math (no floats) + tax/total helpers
- `src/lib/utils.ts` — shared helpers
- `app/` route groups: `(auth)` sign-in/sign-up, `(app)/[businessId]/…` shell + placeholder screens, `api/auth/[...all]` handler
- Pinned `package.json`, `tsconfig.json`, `next.config.ts`, ESLint flat config, Prettier, `.gitignore`, `.env.example`

## Built in Phase 1 so far (branch `phase-1/mvp-core`)
- **Auth flow:** real sign-up (creates user → Business → OWNER Membership) and sign-in via Better Auth; `src/features/auth/actions.ts`
- **Guards:** `(app)/layout.tsx` (session) + `(app)/[businessId]/layout.tsx` (membership via `requireMembership`, renders the shell with real nav + sign-out)
- **Catalog read:** `src/features/catalog/queries.ts` (`getRegisterCatalog`, businessId-scoped)
- **Register:** `src/features/register/components/Register.tsx` — touch cart, search, qty, discount, tip presets, cash tender + change, receipt view
- **Checkout action:** `src/features/register/actions.ts` — **server recomputes all totals** from DB prices + business tax rate, idempotent on `clientUuid`, writes Order/OrderLine/Payment in a transaction
- deps installed; `npm run build` passes

## Verified live (2026-06-13)
DB is live on **Neon**; `prisma migrate dev` (migration `init`) + `db:seed` ran. End-to-end smoke test passed: Better Auth sign-up/session over HTTP, money math (8.25% tax correct), Order/OrderLine/Payment writes, and `clientUuid` idempotency (duplicate rejected by unique constraint). `.env.local` holds the connection string + generated `BETTER_AUTH_SECRET` (gitignored).

### Test login — `owner@valla.test` / `supersecret123` (as of #20)
**Until #20 this login did not exist.** The old seed created a demo business with **no member**, so signing in never reached the seeded catalog. #20's seed now creates the owner via Better Auth (`signUpEmail` — correct password hashing + `User`/`Account` rows) and makes them **OWNER** of the demo business as their first membership, so sign-in routes straight there (`getPrimaryBusinessId`). Idempotent: it deletes the prior demo-named business (cascade) and reuses the owner user. **Run `npm run db:seed`** to (re)create the login + demo catalog (incl. the burger's Cook/Add-ons modifiers).

## Products CRUD (branch `phase-1/products-crud`)
- `getManagedCatalog` + catalog write actions (`createCategory`/`deleteCategory`/`createItem`/`deleteItem`), role-gated to MANAGER+, tenant-scoped deletes, `revalidatePath` on products + register
- `ProductsManager` client UI: add item (name/type/category/price → Default variation), add/delete categories, delete items
- Fixed latent bug: register query now queries items directly so **uncategorized items still appear**
- Verified create/list/delete against live DB

## Settings (branch `phase-1/settings`)
- `updateBusinessSettings` action (OWNER-only): business name, tax rate (% → basis points), currency, tax-inclusive toggle; revalidates the business layout
- `SettingsForm` UI; non-owners see a read-only notice
- **Tax-inclusive mode is now real:** `money.ts` `computeTotals` handles inclusive (embedded) tax via `embeddedTaxOf`, threaded through the register (display) and checkout (server-authoritative). Verified: $10 @ 8.25% → exclusive total $10.83 / inclusive total $10.00 with 76¢ embedded
- The register no longer hardcodes tax — it reads `taxRateBps` + `taxInclusive` from the business

## Orders + Z-report (branch `phase-1/orders-reports`)
- `listOrders` (recent 100, businessId-scoped) → Orders table (number, customer, total, status badge, method, time)
- `getDailyReport` → end-of-day Z-report at `/reports`: orders, gross/discount/net sales, tax collected, tips, total collected, payment-method split, cash collected; day picker via `?date=` (server-rendered GET form)
- Excludes non-PAID + out-of-day orders (verified against live DB)
- Cash-drawer reconciliation (opening float, counted vs expected) still deferred to the cash-drawer-session work

## Tests (branch `phase-1/tests`)
- **Vitest** added (`npm test`); 23 tests across 3 files, all green
- `money.test.ts` — exclusive/inclusive tax, line+cart discounts, tips, modifier deltas, rounding, never-negative total
- `roles.test.ts` — role hierarchy (`roleAtLeast`)
- `schema.test.ts` — checkout input validation (empty cart, bad qty, non-uuid key, negative money)
- Refactored pure role logic into `src/lib/roles.ts` (so tests don't pull in `server-only`); `tenant.assertRole` now uses it
- Config: `vitest.config.ts` (node env, `@`→`src` alias, `src/**/*.test.ts`)
- Still untested (needs DB mocking/integration harness): `requireMembership` isolation, the checkout server action end-to-end (both verified manually against live DB)

## Design-system facelift (branch `facelift/design-system`)
Executes the #1–#3 "do first" items from `docs/IMPROVEMENT_PLAN.md`:
- **Design tokens:** OKLCH "Calm Teal" semantic tokens in `globals.css` (light + dark via the shadcn `@theme inline` pattern), radius/elevation, focus ring, 44px touch law, reduced-motion
- **Primitives** (`src/components/ui/`): Button (CVA, 48px default), Card, Input, Label, Badge, Skeleton — replacing duplicated class strings
- **Inter** via `next/font`; `.numeric` (tabular-nums) on all money/qty
- **Light/dark** via `next-themes` (`ThemeProvider` + `ThemeToggle`); removed global zoom-lock (WCAG 1.4.4)
- **Mobile bottom-tab nav** + mobile top bar (`app-nav.tsx`) — app was unusable below `lg` before; desktop sidebar restyled with active states + icons
- **Route `loading.tsx` skeletons + `error.tsx` boundary** under `[businessId]`
- Converted all screens (auth, landing, register, products, settings, orders, reports) to tokens/primitives; orders table reflows to cards on mobile; fixed `text-slate-400` contrast; `aria-live`/`role` on errors
- Deferred to later PRs: Radix Sheet/Numpad, full split-screen/sticky-cart register UX (the styled delete-confirm dialog landed in Phase 2 — see below)
- Verified: typecheck + lint + 23 tests + build all green

## Order-number race fix (branch `phase-2/order-number-race`)
First Phase 2 item from the improvement plan. Replaced the racy `findFirst(max number)+1` in `register/actions.ts` (two concurrent cashiers could collide on `@@unique([businessId, number])`) with an **atomic per-business counter**:
- New `OrderCounter` model (`businessId @id`, `lastNumber @default(0)`); checkout allocates the next number via `upsert … { lastNumber: { increment: 1 } }` **inside the existing transaction** — the row lock serializes concurrent cashiers. `upsert` is defensive so a counter-less business self-heals on first sale.
- Counter row is eager-created at business signup (`auth/actions.ts`) and in `seed.ts`.
- Migration `20260613050920_order_counter` creates the table **and backfills** existing businesses to `COALESCE(MAX(number),0)` so live sequences continue (the demo business won't restart at 1).
- Verified locally: typecheck + lint + 23 tests + build all green. **Migration applied to Neon** (`20260613050920_order_counter`); concurrency smoke test (`prisma/smoke-order-race.ts`, 50 parallel allocations) printed `PASS: no collisions` — unique + contiguous 1..50. Dev-only helper: created a gitignored `.env` with just `DATABASE_URL` so the Prisma CLI/scripts load it natively.

## Cash-drawer session + reconciliation (branch `phase-1/cash-drawer`, #16)
- **No schema change** — the `CashDrawerSession` model (opening-float / expected / counted / variance cents, open+close timestamps) was already in `init`.
- `/[businessId]/drawer`: open a session with an opening float (**CASHIER+**); blind-count close reveals expected + variance (**MANAGER+**). Expected cash = opening float + Σ CASH payments on PAID orders during the open window — reuses the Z-report's exact "cash collected" definition, so the two always agree. The Z-report now shows the day's drawer variance.
- Reads in `src/features/cash-drawer/queries.ts`, writes in `actions.ts` (zod, role-gated), pure logic in `reconcile.ts`. +19 tests.

## Cart modifiers + per-line tax (branch `phase-1/cart-modifiers`)
- **No schema change** — the `ModifierGroup`/`Modifier`/`ItemModifierGroup`/`OrderLineModifier` models + `OrderLine.taxCents` were already in `init`.
- **Catalog mgmt:** `createModifierGroup`/`deleteModifierGroup`/`createModifier`/`deleteModifier`/`linkModifierGroup`/`unlinkModifierGroup` actions (MANAGER+, tenant-scoped, defense-in-depth ownership checks). Catalog zod schemas extracted to `src/features/catalog/schema.ts` (testable, non-server). `ProductsManager` UI: manage groups/modifiers + per-item link chips. `getManagedCatalog` now returns `modifierGroups` + each item's `modifierGroupIds`.
- **Register:** `getRegisterCatalog` includes each item's linked groups/modifiers; `Register.tsx` opens a modifier picker (honors min/maxSelect) when a modified item is added; cart lines are keyed by (variation + chosen modifiers); modifier deltas join the taxable base and show on the line.
- **Checkout (server-authoritative):** schema accepts `modifierIds` per line; the action re-looks-up every modifier from the DB (businessId-scoped via the item), validates min/maxSelect + rejects unknown/foreign ids, computes **per-line `taxCents`** and snapshots each chosen modifier as `OrderLineModifier` in the same `$transaction`. Order tax is **derived by summing line taxes** (`Order.taxCents == Σ OrderLine.taxCents`), so rounding can't drift. Pure logic in `src/features/register/pricing.ts` (non-server) — verified to match `money.ts computeTotals`.
- **Receipt** shows per-line modifiers; receipt line type carries `taxCents` + `modifiers`.
- Tests: +21 (pricing math/reconciliation, catalog schema, checkout modifier/validation paths). Full suite **104 green**; typecheck + lint + build all pass.

## Confirm dialog (branch `phase-2/confirm-dialog`, #21)
First Phase 2 polish item. Replaced the three `window.confirm()` calls in the catalog manager (item / category / modifier-group deletes) with an accessible Radix-based dialog.
- New `src/components/ui/dialog.tsx` — shadcn-style Radix Dialog primitives (overlay, content, header/footer/title/description), tokenized, static (no entrance animation; honors the global reduced-motion guard). Reusable for the still-deferred Sheet/Numpad register polish.
- New `src/components/ui/confirm-dialog.tsx` — promise-based `useConfirm()` hook: `await confirm({ title, … })` resolves true/false; escape/overlay/cancel resolve false; destructive styling by default.
- Adds `@radix-ui/react-dialog@1.1.16` (pinned). Verified: typecheck + lint + **104 tests** + build green. Behavior still wants the human click-through pass below.

## Better Auth security bump (branch `security/better-auth-bump`, #23)
Resolves the critical Better Auth advisories. **`better-auth` `1.2.8 → 1.6.18`** (pinned); `npm audit` now shows the Better Auth criticals cleared.
- **No migration needed:** re-ran the schema generator against installed 1.6.18 and diffed — every expected column already exists; zero new columns/tables. Full write-up appended to `docs/BETTER_AUTH_AUDIT.md`.
- **Config API unchanged** (`auth.ts` / `auth-client.ts` untouched); typecheck clean.
- **Runtime-verified** against live Neon via new `prisma/smoke-auth.ts` (sign-up → hashed credential → sign-in → session; wrong-password rejected). Re-run after future auth bumps: `npx tsx prisma/smoke-auth.ts`.
- typecheck + lint + 104 tests + build all green.

## Dependency/security advisory sweep (branch `security/next-esbuild-postcss`, #24)
Clears the remaining (non-auth) advisories. Combined with #23, **`npm audit` on `main` now reports 0 vulnerabilities.**
- **`next` `15.3.8 → 15.5.19`** (+ `eslint-config-next` 15.5.19 in lockstep) — fixes the HIGH image-optimizer SSRF + cache-key-confusion advisories.
- **`tsx` `4.19.4 → 4.22.4`** — pulls `esbuild` 0.28.1 (out of the vulnerable range); clears the tsx + esbuild advisories.
- **`overrides.postcss = 8.5.15`** — Next 15.5.19 still bundles `postcss@8.4.31` (`<8.5.10` XSS-stringify, no upstream fix); the override dedupes every postcss to the patched 8.5.15. Build-time only (Next runs postcss over our own CSS, not user input).
- Verified on the combined branch: 0 audit findings, typecheck + lint + 104 tests + build green, **Serwist still emits `public/sw.js`** (Next-minor + PWA intact), and the live auth smoke still PASSes with 1.6.18 + 15.5.19 together.

## Reporting depth — sales by item/category + CSV export (branch `phase-2/reporting-depth`, #26)
First Phase 2 "reporting depth" slice. Read-only, no schema change, no money writes.
- `src/features/orders/report-aggregate.ts` (pure, unit-tested): `aggregateItemSales()` (per-item qty/net/tax + per-category totals, sorted by net) and `buildReportCsv()` (RFC-4180, CRLF, escaped, plain-decimal amounts).
- `getItemSalesReport()` in `queries.ts` over PAID orders; category resolved best-effort from `variationId` via one batched lookup, keyed on the durable `nameSnapshot`.
- `/[businessId]/reports/export?date=` route handler — membership-guarded CSV download (401/403 on auth/forbidden).
- Reports page gains "Sales by item" + "Sales by category" tables and an Export CSV link.
- +8 tests; suite **112 green**. typecheck + lint + build all pass. (`queries.ts` is `server-only` → no headless smoke; covered by typecheck + build + unit tests + the standing human click-through.)

## Refunds & voids (branch `phase-2/refunds-voids`)
Migration-free (reused the existing `REFUNDED`/`PARTIALLY_REFUNDED`/`VOIDED` + `PaymentStatus.REFUNDED` enums). MANAGER-gated.
- **Actions** (`src/features/orders/actions.ts`): `voidOrder` (PAID only → `VOIDED`) and `refundOrder` (full → `REFUNDED`; partial `amountCents` → `PARTIALLY_REFUNDED`, promoted to `REFUNDED` when the balance is exhausted). Both write **reversing negative `Payment` rows** (method matching the original, `status REFUNDED`) inside a `$transaction`, flip the original captures to `REFUNDED` on a full settle, and are strictly `businessId`-scoped via `requireMembership` + `assertRole(MANAGER)`. Guards reject already-settled orders, over-refunds (> net-collected, accounting for prior partials), and non-positive amounts (typed result union, no throws on the expected-failure paths).
- **Reconciliation decision (approved):** the drawer's expected-cash and the Z-report now count cash by **actual payment movements** — `Σ CASH Payment.amountCents` over the window, **status-agnostic, negative refunds included** — instead of filtering `Order.status = PAID`. So a cash refund reduces both expected drawer cash and Z-report cash and the till still reconciles. `getDailyReport`'s sales lines (orders/gross/net/tax/tips) still exclude VOIDED + fully-REFUNDED (PARTIALLY_REFUNDED stays a reduced sale); added a **Refunds** figure (Σ negative payments, shown positive) to the Z-report + CSV.
- **Pure module** `src/features/orders/refund.ts` (no `server-only`): net-collected-by-method, full-reversal plan, partial-refund plan + validation. Hard-tested.
- **UI:** MANAGER-gated Refund / Partial refund / Void controls on the order receipt page via the shared `useConfirm` dialog + existing primitives; status badges already render REFUNDED/VOIDED/PARTIALLY_REFUNDED.
- Tests: +34 (refund math, refund/void action paths incl. role gate + tenant scoping, a cash-refund-reduces-expected-cash reconcile case, Refunds CSV row). Suite **146 green**; typecheck + lint + build all pass. (`queries.ts`/`actions.ts` are `server-only` → covered by the pure unit tests + the mocked action tests + typecheck + build; standing human click-through still applies.)

## Catalog editing depth (branch `phase-2/catalog-editing`, #29)
Migration-free (all columns existed). MANAGER-gated, tenant-scoped.
- Actions (`catalog/actions.ts`): `updateItem` (name/type/category + the Default variation's price), `createVariation`/`updateVariation`/`deleteVariation` (sizes — guards an item keeps ≥1 variation), `setItemActive` (archive/restore via `updateMany` scoped by businessId), `updateCategorySortOrder`. Friendly SKU unique-violation (P2002) errors.
- `getManagedCatalog` now returns archived items too (active-first, with variation `sku`/`sortOrder`); **`getRegisterCatalog` already filtered `active:true`** (verified, unchanged) so archived items leave the register immediately.
- `ProductsManager` UI: inline item editor, per-item variations editor with up/down reorder, archive/restore + "Show archived (N)" filter. +25 schema tests.

## Employee management + PIN + clock-in (branch `phase-2/employee-pin`, #32 — MERGED, migration applied)
- **Schema change (migration `20260614195453_employee_timeentry` APPLIED to Neon via `prisma migrate deploy`):** new `TimeEntry` model (businessId/membershipId/clockInAt/clockOutAt? + 3 indexes + cascade FKs) and `Membership.active` (Boolean, default true). `Membership.pinHash` already existed.
- Pure, tested modules: `employees/pin.ts` (scrypt salted hash + constant-time verify — hash never leaves the server) and `employees/duration.ts` (timesheet math). Actions (OWNER/MANAGER-gated): addMember (links an **existing** account by email — new-user signup is out of scope), changeMemberRole, set/clearMemberPin, setMemberActive, verifyMemberPin, clockIn/clockOut (self-service: membership from the tenant context, never client-sent). +20 tests.
- **Deploy order (resolved):** the migration was applied to Neon **before** the merge (`git checkout phase-2/employee-pin && npx prisma migrate deploy`, then `gh pr merge`), so the deployed code never hit an un-migrated DB. Lesson: `migrate deploy`/`dev` must run from the branch that *contains* the migration file — running it on `main` pre-merge finds nothing. Post-merge verified: `prisma migrate status` = up to date, 199 tests, build green.

## Register UX uplift — category tabs + touch numpad (branch `phase-2/register-ux`, #34)
First slice of the "register UX uplift to competitor standard" item. No schema, no new deps. (The split-screen sticky cart, search, tip presets, and direct cart `+/−` already existed.)
- **Pinned category tabs** filter the item grid by category ("All" + distinct), combined with search; hidden when there's only one category.
- **Touch numpad cash tender** replaces the bare text input: big amount display, quick-cash chips (Exact / next dollar / covering bills), a 44px `NumberPad`, live "change due", Complete disabled until tendered ≥ total.
- Pure tested helpers `src/features/register/tender.ts` (`applyNumpadKey`, `dollarsToCents`, `quickTenderOptions`) + `src/components/ui/number-pad.tsx`. +8 tests; suite **179 green**.
- Deferred (need infra/decisions): image tiles, per-device Favorites, open-tickets/save-cart sync, grid⇄list density toggle, migrating the modifier picker to the Radix Dialog primitive.

## Dev-experience + SEO polish (#28 eslint, #30 metadata)
- **#28** `eslint.config.mjs`: ignore generated/non-source files (`public/sw.js`, Serwist dev shims, the Next-generated `next-env.d.ts` whose typed-routes triple-slash tripped a rule after a build under Next 15.5, and `.claude/**`). `eslint .` went from ~93 phantom errors to clean; also hardens CI's `eslint .` against build-ordering.
- **#30** root `metadata`: added `metadataBase` (removes Next's warning), `title` template (`%s · VallaPOS`), Open Graph + Twitter cards. Auth pages left untouched (they're `"use client"`; not refactoring auth pre-sign-off).

## Security hardening (audit #38 → fixes #39–#42, #40) — 2026-06-14
A read-only security audit (`docs/SECURITY_AUDIT.md`, #38) found **no Critical issues** — the core (tenant isolation, IDOR, role gates, idempotent checkout, scrypt PINs, card data brand/last4, secure cookies, server-action CSRF) is solid. The HIGH/MED gaps are now fixed (fanned out across 4 agents + the Upstash wiring):
- **H-1 HTTP security headers (#39):** `next.config.ts` now sets HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control on all routes, plus a **report-only CSP** (`Content-Security-Policy-Report-Only`) — enforce-mode w/ nonces is a follow-up.
- **H-2 CSV formula injection (#39):** `report-aggregate.ts` `sanitizeTextCell()` prefixes a leading `= + - @ \t \r` with `'`, applied ONLY to the user-text cells (item/category names) so numeric amount cells stay SUM-able.
- **H-3 rate-limit storage (#40):** Upstash Redis wired as Better Auth `secondaryStorage` + `rateLimit.storage="secondary-storage"` (shared/persistent across Vercel instances). **Optional** — unset = unchanged in-memory fallback; `storeSessionInDatabase:true` keeps the DB the session source of truth. ⚠ **User must set `UPSTASH_REDIS_REST_URL` + `_TOKEN` in Vercel (Prod+Preview) + `.env.local`** to activate.
- **M-2 account enumeration (#41):** sign-up no longer reveals whether an email exists (neutral message on `USER_ALREADY_EXISTS`; sign-in was already generic).
- **M-4 offline PII on sign-out (#41):** `SignOutButton` now flushes (if online) then clears the `vallapos-offline` IndexedDB queue; if unsynced sales remain offline it warns + can abort sign-out.
- **M-1 tenant-isolation guard (#42):** a dependency-free static vitest check (`src/test/tenant-isolation.guard.test.ts`) fails CI if a tenant-owned model query omits `businessId`; honors `// tenant-ok:` opt-out. Found no real gaps today.
- Verified together on `main`: typecheck + lint + **205 tests** + build green; `npm audit` = 0.

## Still open
_All Phase 2 + both security hardening batches are merged (`npm audit` = 0; 219 tests). What's left: a couple of security items needing your input, human verification, optional polish. (The GitHub Actions billing block that gated CI through June was resolved 2026-06-26 — CI runs again.)_

**Security re-audit 2026-06-14 (6-agent read-only sweep, `docs/SECURITY_AUDIT.md` Re-audit section):** core still solid — no Critical/cross-tenant leak/auth-bypass/money hole; the #39–#42 fixes all re-verified holding.

**✅ Fixed in the #44 re-audit hardening batch (this section previously mislabeled these as open):**
- **R-2 (Med) — DONE:** per-membership PIN brute-force throttle/lockout in `src/lib/pin-throttle.ts` (Upstash-backed when configured, in-memory fallback), wired into `verifyMemberPin`; returns a generic `{ valid: false }` on lockout (anti-enumeration).
- **R-3 (Med) — DONE:** checkout catches the `@@unique([businessId, clientUuid])` P2002, re-reads the winner, and returns its receipt (idempotent concurrent double-send). Concurrent-race test coverage added in #47.
- **R-4 (Med) — DONE:** CI runs `npm audit --omit=dev --audit-level=high` (in `.github/workflows/ci.yml`). _(Live again — Actions billing resolved 2026-06-26.)_
- **R-6 — DONE:** `poweredByHeader: false` in `next.config.ts`.
- **R-8 — DONE:** `trustedOrigins: [env.BETTER_AUTH_URL]` pinned in `auth.ts`.

**Still open, by priority:**
- **R-1 (High) — PR #45 open, awaiting human sign-off:** service worker caches authed HTML/RSC (`app/sw.ts` Serwist `defaultCache`, 24h) with no per-user keying and no Cache-Storage purge on sign-out → shared-device cross-user exposure (long-tracked M-5). PR #45 adds a `NetworkOnly` matcher for `(app)/[businessId]/**` + `caches.delete()` on sign-out; CI-green but parked for a human offline click-through because it changes PWA caching.
- Lower: **R-5** — CSP still report-only, but a `report-uri`/`report-to` + `/api/csp-report` collector now exist (#59); enforce-mode w/ nonces is still the deferred, prod-risky, human-verified follow-up. **R-7 — ✅ DONE (#59):** offline PII now AES-GCM encrypted at rest. R-9 tenant guard is heuristic. **R-10 (non-negative prices) already enforced** (zod `min(0)` on all price inputs). **R-11 DONE** — store checkout now stamps `Order.cashierId` (#51; tabs already did), surfaced as a "Sales by cashier" Z-report table (#52).
- **✅ GitHub Actions billing — RESOLVED 2026-06-26:** the `quality` CI gate runs again (verified passing in ~1m26s on `main`). It was billing-suspended for most of June (the job failed in ~2s — *"recent account payments have failed or your spending limit needs to be increased"*), so PRs merged without a CI gate during that window; all were retroactively confirmed green once CI returned.
- **⚠ Activate Upstash (H-3):** create a free Upstash Redis DB and set a **valid** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel (Prod+Preview) and `.env.local`. Until then the rate limiter is per-instance in-memory. **As of #46 an invalid/blank value no longer breaks the build** — `env.ts` degrades it to undefined (in-memory fallback) and warns; the prior empty value in Vercel was crashing every deploy.
- **Security follow-ups (deferred):** **M-3** require email verification (needs the parked Resend provider — do with receipt email); **M-5** stop the service worker caching authed pages (Serwist tuning — careful, risks the PWA; do as its own verified PR); CSP **enforce mode** with nonces (currently report-only).
- **Browser sign-off (security bumps + hardening):** #23 (auth) and #24 (Next) are server-verified and CI-green, but the `authClient` React/cookie/redirect path + the new headers/sign-up/sign-out behavior still want a human click-through (sign-up → sign-in → sign-out, click around the register).
- **Manual UI click-through** on a dev server: `npm run db:seed`, sign in (`owner@valla.test` / `supersecret123`), ring up the burger with **Cook + Add-ons**, cash checkout → receipt → open/close drawer → offline queue. Still wants a human pass.
- **Live PWA verification:** real install + an actual offline checkout session (#13 was verified by build emission only).
- **Receipt email:** ✅ DONE in #60 — Resend wired behind the #11 scaffold, dormant until `RESEND_API_KEY` (+ optional `RECEIPT_FROM_EMAIL`) is set in Vercel + `.env.local`.
- Optional cosmetic: lowercase `@@map` on the 4 Better Auth models (`docs/BETTER_AUTH_AUDIT.md`) — migration, low priority.

> **On migrations:** the two features once flagged "needs a migration" turned out not to — **cash-drawer (#16)** and **cart-modifiers (#18)** both used models already present in `init`. When a future change *does* alter `prisma/schema.prisma`: do it on its own branch, never in a parallel fan-out (concurrent `prisma migrate` against the shared Neon DB corrupts `_prisma_migrations`). The agent can generate a migration (`--create-only`; gitignored `.env` holds `DATABASE_URL`) but **applying** it is gated → hand the user `! npx prisma migrate dev`.

## Key invariants (do not break)
1. **Tenant isolation:** every tenant-owned query goes through `requireMembership(businessId)` and includes `where: { businessId }`. A missing filter = cross-business data leak.
2. **Money is integer cents.** Never use floats for money. Tax rates are basis points (e.g. `825` = 8.25%).
3. **Pin dependencies.** No `"latest"`. Commit the lockfile.
4. **Reads** live in `src/features/*/queries.ts` (server-only). **Writes** live in `src/features/*/actions.ts` (`"use server"`), validated with zod.

## Decisions on record
- Hosting: **Vercel + Neon Postgres** (no separate API server).
- Auth: **Better Auth**, build now; **payments deferred** (cash/manual for v1).
- Browser-POS reality: Tap-to-Pay & Bluetooth readers are native-only → card-present is sequenced to a later native shell; lead with cash + QR/Terminal.

## Next step
**Human-only (automation can't cover these):** **(1) ~~Fix GitHub Actions billing~~ ✅ DONE (2026-06-26 — CI runs again).** **(2) Browser sign-off on the just-merged batch** — #57 register UX (mobile Sheet / Favorites / density on a real phone), #59 offline (encrypted-queue ring-up → reconnect replay; sign-out with an unsynced sale) + confirm CSP reports land at `/api/csp-report`. **(3) Merge/sign-off PR #45** (R-1 SW cache) after an offline click-through. **(4) Activate** Resend (`RESEND_API_KEY` (+ `RECEIPT_FROM_EMAIL`), turns on #60) and Upstash (shared rate limiting) by setting their env vars in Vercel + `.env.local`. **(5) Full manual ring-up** (`! npm run db:seed` → operator PIN-lock → ring up → receipt/email → refund/void → drawer → employees/clock-in → offline → restaurant floor/tab split-settle).

**Build-next (agent-doable):** decide the **payments direction** (the 4 #58 decisions above) to move from the shipped Manual/Other tender (✅ #62) → QR → Terminal; CSP **enforce mode** with nonces (own verified PR); image tiles + open-tickets/save-cart (both need a schema migration → own branch); multi-sensory tap confirmation.
