# VallaPOS — Project State

> **Read this first.** This is the single source of truth for what exists, what's wired, and what's next. Update it as work lands.

_Last updated: 2026-06-13 — Phase 1 nearly complete; 4 PRs in review._

## Where we are

The original prototype was replaced with a restructured foundation (Phase 0, PR #1). **Phase 1 is essentially complete and live on Neon.** Merged to `main` (newest first): facelift/design-system (#8), Phase 2 order-number race fix (#9), RSC CVE fix (#10), CI quality gate (#7), Vitest suite (#6), Orders + Z-report (#5), Settings + tax-inclusive pricing (#4), Products CRUD (#3), Phase 1 MVP core spine (#2). The "ring up a sale" loop — auth + business bootstrap, route guards, catalog read, server-authoritative cash checkout — is verified end-to-end against the live DB.

**Four PRs are currently in review (opened 2026-06-13, all mergeable, all verified locally `typecheck`+`lint`+`test`+`build`):**
- **#11** `phase-1/receipt` — order receipt view (printable, tenant-scoped) + credential-free email scaffold. _CI green._
- **#12** `phase-1/integration-tests` — tenant-isolation + checkout-action tests (Prisma mocked); suite 23 → 45 tests. _CI green._
- **#13** `phase-1/pwa-offline` — Serwist service worker + installable manifest/icons + IndexedDB offline checkout queue (replays on reconnect via existing `clientUuid` idempotency).
- **#14** `chore/better-auth-audit` — `docs/BETTER_AUTH_AUDIT.md`: ran `@better-auth/cli@1.2.8 generate` vs schema; **no auth-breaking discrepancies**. Only optional cosmetic `@@map` table-rename recommended (migration, deferred).

Review/merge these, then update this section as they land.

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
DB is live on **Neon**; `prisma migrate dev` (migration `init`) + `db:seed` ran. End-to-end smoke test passed: Better Auth sign-up/session over HTTP, money math (8.25% tax correct), Order/OrderLine/Payment writes, and `clientUuid` idempotency (duplicate rejected by unique constraint). Test owner seeded: **owner@valla.test / supersecret123** (OWNER of the demo business). `.env.local` holds the connection string + generated `BETTER_AUTH_SECRET` (gitignored).

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
- Deferred to later PRs: Radix Dialog/Sheet/Numpad, styled delete-confirm dialog (still `window.confirm`), full split-screen/sticky-cart register UX
- Verified: typecheck + lint + 23 tests + build all green

## Order-number race fix (branch `phase-2/order-number-race`)
First Phase 2 item from the improvement plan. Replaced the racy `findFirst(max number)+1` in `register/actions.ts` (two concurrent cashiers could collide on `@@unique([businessId, number])`) with an **atomic per-business counter**:
- New `OrderCounter` model (`businessId @id`, `lastNumber @default(0)`); checkout allocates the next number via `upsert … { lastNumber: { increment: 1 } }` **inside the existing transaction** — the row lock serializes concurrent cashiers. `upsert` is defensive so a counter-less business self-heals on first sale.
- Counter row is eager-created at business signup (`auth/actions.ts`) and in `seed.ts`.
- Migration `20260613050920_order_counter` creates the table **and backfills** existing businesses to `COALESCE(MAX(number),0)` so live sequences continue (the demo business won't restart at 1).
- Verified locally: typecheck + lint + 23 tests + build all green. **Migration applied to Neon** (`20260613050920_order_counter`); concurrency smoke test (`prisma/smoke-order-race.ts`, 50 parallel allocations) printed `PASS: no collisions` — unique + contiguous 1..50. Dev-only helper: created a gitignored `.env` with just `DATABASE_URL` so the Prisma CLI/scripts load it natively.

## Cart modifiers + per-line tax (branch `phase-1/cart-modifiers`)
- **No schema change** — the `ModifierGroup`/`Modifier`/`ItemModifierGroup`/`OrderLineModifier` models + `OrderLine.taxCents` were already in `init`.
- **Catalog mgmt:** `createModifierGroup`/`deleteModifierGroup`/`createModifier`/`deleteModifier`/`linkModifierGroup`/`unlinkModifierGroup` actions (MANAGER+, tenant-scoped, defense-in-depth ownership checks). Catalog zod schemas extracted to `src/features/catalog/schema.ts` (testable, non-server). `ProductsManager` UI: manage groups/modifiers + per-item link chips. `getManagedCatalog` now returns `modifierGroups` + each item's `modifierGroupIds`.
- **Register:** `getRegisterCatalog` includes each item's linked groups/modifiers; `Register.tsx` opens a modifier picker (honors min/maxSelect) when a modified item is added; cart lines are keyed by (variation + chosen modifiers); modifier deltas join the taxable base and show on the line.
- **Checkout (server-authoritative):** schema accepts `modifierIds` per line; the action re-looks-up every modifier from the DB (businessId-scoped via the item), validates min/maxSelect + rejects unknown/foreign ids, computes **per-line `taxCents`** and snapshots each chosen modifier as `OrderLineModifier` in the same `$transaction`. Order tax is **derived by summing line taxes** (`Order.taxCents == Σ OrderLine.taxCents`), so rounding can't drift. Pure logic in `src/features/register/pricing.ts` (non-server) — verified to match `money.ts computeTotals`.
- **Receipt** shows per-line modifiers; receipt line type carries `taxCents` + `modifiers`.
- Tests: +21 (pricing math/reconciliation, catalog schema, checkout modifier/validation paths). Full suite **104 green**; typecheck + lint + build all pass.

## Still TODO in Phase 1
_Done / in review (see PRs #11–#14 above): receipt view + email scaffold, integration tests (tenant isolation + checkout), PWA + offline queue, Better Auth schema audit. CI workflow shipped in #7._
- **Manual UI click-through** of sign-up → ring-up-a-sale (dev server run; awaiting human feedback) — also exercise the new receipt page and offline-queue once #11/#13 merge
- **Cash drawer session** (opening float → counted vs expected) — **needs a schema migration**
- ~~**Modifiers in cart + per-line tax detail**~~ — DONE (branch `phase-1/cart-modifiers`, see above). No migration needed; the models were already in `init`.
- Receipt email: wire a real provider (Resend) behind the `RESEND_API_KEY` scaffold added in #11

> **Migration-dependent work is serialized on purpose.** Cash-drawer and cart-modifiers both alter `prisma/schema.prisma` and apply migrations to the shared Neon DB — do them one at a time (not in a parallel fan-out) to avoid `_prisma_migrations` conflicts. The agent CAN run migrations now (gitignored `.env` holds `DATABASE_URL`), but apply each on its own branch and verify before the next.

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
Review + merge the four open PRs (#11–#14), updating "Where we are" as they land. Then start the serialized migration work: **cash-drawer session** first (open float → counted vs expected, reconciles against the Z-report), then **cart modifiers + per-line tax**. Each on its own branch, migration applied + verified before the next. Manual sign-up → ring-up-a-sale → receipt → offline-queue click-through still wants a human pass on the dev server.
