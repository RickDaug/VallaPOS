# VallaPOS — Architecture

How VallaPOS is built and the reasoning behind each choice. Pairs with [`PRD.md`](./PRD.md) (what) and [`ROADMAP.md`](./ROADMAP.md) (when).

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js App Router | Server components + server actions; one deployable, no separate API |
| UI | React + TypeScript | RSC + Actions are first-class |
| Styling | Tailwind CSS | Fast, utility-first; touch-friendly design tokens |
| ORM | Prisma | Typed data access + migrations |
| Database | PostgreSQL on **Neon** | Scale-to-zero fits indie POS; CI branch-per-run |
| Auth | **Better Auth** | TS-native, self-hosted in our Postgres, built-in orgs + roles for multi-tenancy |
| Offline | **Serwist** (`@serwist/next`) + IndexedDB | Official next-pwa successor; structured offline queue |
| Hosting | Vercel (web) + Neon (db) | Simplest path for a solo dev |

> **Why not a separate API server (Railway-style)?** A solo POS doesn't need one. Server actions handle in-app writes; the few things that *must* be HTTP endpoints (auth handler, payment webhooks, the offline-sync endpoint) live in `app/api`. Less to run, less to break.

## 2. Project structure

`app/` is routing-only and thin. All logic lives in `src/`, co-located by feature.

```
vallapos/
├─ app/                          # ROUTING ONLY — mostly server components
│  ├─ (auth)/                    # sign-in / sign-up (no app chrome)
│  ├─ (app)/                     # authenticated POS shell
│  │  ├─ layout.tsx              # guards session, loads business, renders shell
│  │  └─ [businessId]/           # tenant in the URL — shareable, debuggable
│  │     ├─ register/            # the POS register screen (client-island heavy)
│  │     ├─ products/  orders/  reports/  settings/
│  ├─ api/
│  │  └─ auth/[...all]/route.ts  # Better Auth catch-all
│  ├─ layout.tsx  globals.css  manifest.ts
│
├─ src/
│  ├─ features/                  # one folder per domain
│  │  └─ <domain>/
│  │     ├─ components/          # client islands for that feature
│  │     ├─ actions.ts           # "use server" writes (zod-validated)
│  │     ├─ queries.ts           # server-only reads
│  │     └─ schema.ts            # zod input schemas
│  ├─ lib/
│  │  ├─ env.ts    # zod-validated process.env
│  │  ├─ db.ts     # Prisma singleton
│  │  ├─ auth.ts / auth-client.ts
│  │  ├─ tenant.ts # requireMembership() — the isolation choke point
│  │  ├─ money.ts  # integer-cents math
│  │  └─ utils.ts
│  └─ components/ui/             # generic dumb reusable (Button, Money, Dialog)
│
└─ prisma/schema.prisma
```

**Server vs client rule:** default to **server components**. A component becomes a client island (`"use client"`) only when it needs interactivity/state — the cart, keypad, tender modal, sync indicator. The register screen is the one large justified client island; everything else stays server-first. **Data access never lives in client components.**

## 3. Data layer & multi-tenancy

Isolation strategy: **application-level `businessId` scoping**, defense in depth. (Postgres RLS is deferred — heavier, add only if a customer demands it.)

1. **Schema** — every tenant-owned table carries `businessId`, indexed; uniqueness is *per tenant* (e.g. `@@unique([businessId, sku])`).
2. **One choke point** — `src/lib/tenant.ts` exposes `requireMembership(businessId)`: it validates the session, confirms the user is a member of that business, and returns `{ user, businessId, role }`. Every server action/query starts here and **always** includes `where: { businessId }`.
3. **Reads vs writes** — reads in `features/*/queries.ts` (`import "server-only"`), writes in `features/*/actions.ts` (`"use server"`), every input validated with **zod**.

> The load-bearing invariant: a single forgotten `where: { businessId }` is a cross-tenant leak. Keep the choke point honest; consider a Prisma `$extends` backstop that throws in dev if a tenant model is queried without `businessId`.

**Server Actions vs Route Handlers:** actions for everything the user does in-app (checkout, edit catalog, refund). Route handlers (`app/api`) only for what *can't* be an action: the auth handler, payment webhooks (external POST), and the offline-sync endpoint (the service worker needs a real URL).

## 4. Money

- **All amounts are integer cents** (`priceCents: Int`). No floats anywhere near money — JS float math (`0.1 + 0.2 !== 0.3`) silently corrupts totals.
- **Tax rates are basis points** (`taxRateBps: Int`, `825` = 8.25%).
- Rounding policy: tax is computed **per line, after line discount**, then summed; rounding happens at the cent on each line. This is documented and consistent (the prototype's float math and dual 8.25/0.0825 values are gone).
- All math lives in `src/lib/money.ts` so the rules exist in exactly one place. The client may *display* a total, but the **server recomputes it on checkout** — never trust client totals.

## 5. Auth

**Better Auth**, database sessions (stored in our Postgres — lets us revoke a cashier instantly and audit logins). Rationale: Lucia is deprecated; NextAuth has no built-in orgs/RBAC; Clerk is a paid external vendor. Better Auth's **Organization** maps onto our `Business` + `Membership` + roles (`OWNER`/`MANAGER`/`CASHIER`). The active business is validated against the user's memberships via `requireMembership`; role gates sensitive actions (refunds, price edits, reports).

## 6. Offline / PWA

- **Serwist** generates the service worker; `app/manifest.ts` is the typed manifest; `app/~offline` is the offline fallback.
- Caching: app shell + static = precache; catalog GETs = stale-while-revalidate; **sales POSTs = never cached, queued.**
- **Offline checkout:** cart + completed-but-unsent sales live in **IndexedDB**. Each sale gets a client-generated UUID used as an **idempotency key**.
- **Sync on reconnect:** Background Sync API where supported + an `online`-event fallback (Safari/iOS lack Background Sync). The sync endpoint **upserts on the client UUID** so a double-send never creates a duplicate sale. Non-negotiable for money.

## 7. State management

Server state is the source of truth; client state stays tiny. **No Redux/global store.** Reads via server components; writes via server actions (`revalidatePath`/`revalidateTag`). The **cart** is the one real piece of client state — Zustand in memory, persisted to IndexedDB. Forms use React 19 `useActionState` + server actions.

## 8. Dependency policy

**Pin exact versions. Never `"latest"`. Commit the lockfile.** The old prototype pinned everything to `"latest"`, which means CI and prod can resolve different trees on different days — unacceptable under code that handles money. Upgrade deliberately, reading changelogs. Specific traps to avoid: a beta TypeScript compiler under payment code; Prisma major bumps that change the client/adapter contract; Next minor bumps that shift caching defaults. **Verify the latest stable patch of each dep at install time** and pin it.

## 9. Testing & CI (solo-dev appropriate)

Test the things that lose money or leak data: `requireMembership` rejects non-members; checkout totals/tax math; sync-endpoint idempotency (double-POST = one sale). Tooling: Vitest (unit/integration), one Playwright happy-path (scan → cart → tender → receipt, incl. offline), `tsc --noEmit` + ESLint (flat config) + Prettier. CI on PR/main: install (frozen lockfile) → typecheck → lint → test → `prisma migrate diff` (drift) → build. Use Neon branching for ephemeral test DBs.

## 10. Key risks
1. **Tenant filter discipline** — one missing `where: { businessId }` leaks data. Choke point + Prisma backstop.
2. **Sync idempotency** — client UUID + server upsert, or double-charge on reconnect.
3. **Version discipline** — pin exact; no pre-release under payment code.
4. **Payments** — keep in route handlers + webhooks; store amounts in integer cents; servers never see a PAN.
