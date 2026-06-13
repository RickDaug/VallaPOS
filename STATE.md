# VallaPOS — Project State

> **Read this first.** This is the single source of truth for what exists, what's wired, and what's next. Update it as work lands.

_Last updated: 2026-06-12 — Phase 1 in progress (MVP core spine)._

## Where we are

The original prototype was replaced with a restructured foundation (Phase 0, merged in PR #1). **Phase 1 is now underway** on branch `phase-1/mvp-core`: the "ring up a sale" spine is built — real auth + business bootstrap, route guards, catalog read, and a working register with server-authoritative cash checkout. Verified by `tsc --noEmit` + `next build` (compile/lint/types clean); **not yet run against a live DB** (needs a Neon `DATABASE_URL`).

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

## Still TODO in Phase 1
- **Manual UI click-through** of sign-up → ring-up-a-sale (dev server run; awaiting feedback)
- CI workflow (run typecheck + lint + test on PR)
- Receipt email; cash drawer session (opening float → counted vs expected)
- Modifiers in cart + per-line tax detail (action has hooks, not wired)
- PWA service worker (Serwist) + offline IndexedDB queue (checkout already idempotent)
- Tests (tenant isolation, totals math, idempotency) + CI
- Verify Better Auth Prisma table shape against `npx @better-auth/cli generate` once DB is live

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
Provide a Neon `DATABASE_URL` + `BETTER_AUTH_SECRET` in `.env.local`, run `prisma migrate dev` + `npm run db:seed`, then manually verify the sign-up → ring-up-a-sale loop. After that: Products CRUD, then Z-report/receipts.
