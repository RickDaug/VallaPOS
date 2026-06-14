# VallaPOS — Project State

> **Read this first.** This is the single source of truth for what exists, what's wired, and what's next. Update it as work lands.

_Last updated: 2026-06-14 — Phase 1 + a full Phase 2 batch merged. Merged: #21 confirm dialog, #23 Better Auth 1.6.18, #24 next/tsx/postcss security sweep, #26 reporting depth, #28 eslint hygiene, #29 catalog editing, #30 SEO metadata, #31 refunds & voids + reconciliation, #32 employees + PIN + clock-in (**migration applied to Neon**), #34 register UX (category tabs + touch numpad). **`npm audit` = 0; 199 tests green; 0 open PRs.** Remaining: the standing human browser sign-off (see "Still open")._

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

## Still open
_The full 2026-06-14 batch is merged (`npm audit` = 0; 199 tests; 0 open PRs), employee migration applied to Neon. What's left is human-only verification + optional polish — no pending code._
- **Browser sign-off (security bumps):** #23 (auth) and #24 (Next) are server-verified and CI-green, but the `authClient` React/cookie/redirect path and general render path still want a human click-through (sign-up → sign-in → sign-out, click around the register) to be fully trusted.
- **Manual UI click-through** on a dev server: `npm run db:seed`, sign in (`owner@valla.test` / `supersecret123`), ring up the burger with **Cook + Add-ons**, cash checkout → receipt → open/close drawer → offline queue. Still wants a human pass.
- **Live PWA verification:** real install + an actual offline checkout session (#13 was verified by build emission only).
- **Receipt email:** wire Resend behind the `RESEND_API_KEY` scaffold from #11 — **parked by request.**
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
**(1) Human browser sign-off** — the one thing automation can't cover: the security bumps + full ring-up flow (`! npm run db:seed` → sign in → ring up → receipt → refund/void → drawer → employees/clock-in → offline). **(2) Then** the remaining Phase 2 candidates: more register UX uplift (Radix Sheet/Numpad, sticky-cart split, image tiles, favorites, open-tickets), employee clock-in UI polish, multi-sensory tap confirmation; and Phase 3 (integrated payments — the monetization milestone). Resend receipt email stays parked.
