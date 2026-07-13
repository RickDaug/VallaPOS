# EDITIONS — One Codebase, Two Builds (Cloud + Offline Desktop)

Status: architecture spec (pre-build). This document is the plan of record for splitting
VallaPOS into two editions from a single codebase. Nothing here has shipped yet; Stage 1
is the inert scaffold that changes zero cloud behavior.

An **EDITION** is a build-time switch (`"cloud" | "local"`), **not a fork**. The same
Next.js/TypeScript source, the same pure money/pricing/report/ESC-POS modules, and the
same React register UI power both builds. Only a thin persistence + auth + shell seam
swaps between them.

- **ONLINE (cloud) edition** — the current hosted app at **vallapos.com**. Neon Postgres
  via Prisma, Better Auth sessions, Stripe payments + subscription, multi-tenant. Largely
  unchanged by this work.
- **OFFLINE (local) edition** — a downloadable **Tauri v2 desktop app** sold once ($99) on
  **vallahub.com**. Cash-only, single-tenant, 100% offline, local SQLite, local-PIN auth,
  paper receipts to Epson/Star thermal printers + cash-drawer kick, unlocked by a one-time
  signed license key.

---

## 1. Two-edition architecture

### The switch

A single pure module, `src/lib/edition.ts`, reads one env var and derives every downstream
boolean. It follows the existing flag conventions in `src/features/payments/flags.ts` and
`src/features/peripherals/flags.ts`: a direct `process.env` read (NOT `@/lib/env`) so it is
import-safe and unit-testable, with a `cloud` default so the hosted build is unaffected
unless `NEXT_PUBLIC_VALLA_EDITION=local` is set at build time.

```ts
export type Edition = "cloud" | "local";
export const EDITION: Edition =
  process.env.NEXT_PUBLIC_VALLA_EDITION === "local" ? "local" : "cloud";
export const isLocal  = EDITION === "local";
export const isCloud  = EDITION === "cloud";

export const authMode          = isLocal ? "pin-only" : "session"; // Better Auth vs local PIN
export const dataSource        = isLocal ? "sqlite"   : "neon";
export const isMultiTenant     = isCloud;
export const paymentsEnabled   = isCloud;   // local is CASH-ONLY, Stripe compiled off
export const peripheralsEnabled= isLocal;   // local drives thermal printer + drawer
export const usesCloudSession  = isCloud;   // no Better Auth / Upstash in local
export const requiresLicenseKey= isLocal;   // one-time signed key, not a subscription
```

`NEXT_PUBLIC_` prefix because both the RSC/server layer and the client shell must read it
(mirrors how the Stripe publishable key is exposed today).

### Shared vs swapped

| Concern | Both editions SHARE (verbatim) | Cloud SWAPS in | Local SWAPS in |
|---|---|---|---|
| Money/tax engine | `src/lib/money.ts`, `src/features/register/pricing.ts` (cents/bps, `computePricedOrder`, `priceLine`, `validateGroupSelection`) | — | — |
| Cash-tender math | `src/features/register/tender.ts`, `src/features/register/tip.ts` | — | — |
| Reconcile / Z-report rollup | `src/features/cash-drawer/reconcile.ts`, `src/features/orders/report-aggregate.ts` (aggregation + CSV + timezone day-windows) | — | — |
| Receipt bytes + drawer kick | `src/features/peripherals/escpos.ts` (`formatReceipt`, `drawerKick`, `qrCode`, `fromOrderReceipt`) | — | — |
| Zod contracts | `src/features/*/schema.ts`, `src/features/register/schema.ts` | — | — |
| Register UI + primitives | `src/features/register/components/Register.tsx`, `src/components/ui/*` (incl. `number-pad.tsx`) | — | — |
| PIN hashing algorithm | `src/features/employees/pin.ts` (scrypt via `node:crypto`) | — | — |
| **Data store** | the `DataStore` seam interface (§2) | `PrismaDataStore` → Neon (`src/lib/db.ts`) | `SqliteDataStore` → `@tauri-apps/plugin-sql` |
| **Auth / session** | the capability contract `requireCapability(businessId, cap)` | Better Auth session + `Membership` (`src/lib/auth.ts`, `src/lib/tenant.ts`, `src/lib/operator.ts`) | local PIN + fixed single-tenant context |
| **Persistence engine** | schema shape (`prisma/schema.prisma` model subset) | Postgres provider, all 20 models | SQLite provider, cash subset (§5) |
| **Payments** | — | Stripe Connect (`src/features/payments/*`) | compiled off (cash-only) |
| **Printer transport** | ESC/POS `Uint8Array` payload | WebUSB (`transports/webusb.ts`), CloudPRNT | native Tauri `print_raw` command (§3) |
| **App shell** | React app | Next.js on Vercel (RSC + server actions) | Tauri v2 webview + Rust core, `output: 'export'` static frontend |
| **Unlock / billing** | — | subscription (recurring) | one-time signed license key |
| Offline replay queue | — | `src/lib/offline/*` (encrypted IndexedDB → server sync) | dropped — local DB *is* the source of truth |
| Email receipts | — | `emailReceipt` (Resend) | dropped — paper only |
| Restaurant floor/tabs | `src/features/floor/*`, `src/features/tabs/*` | present | out of scope for cash-only v1 |

**Why so much is shared:** the codebase already stratifies into (a) pure money/report/
ESC-POS logic with zero `server-only`/Prisma coupling, (b) thin Prisma-wrapping orchestration,
and (c) RSC/auth shells. ~80–85% of the cash-only register loop's business logic and UI is
reusable as-is; the real work is a `db`-shaped local adapter and a local-PIN operator guard
of the same signature.

---

## 2. The DATA-STORE SEAM

Today the register client island already treats the server as an RPC boundary:
`src/lib/offline/use-offline-checkout.ts` simply imports `checkout` from
`src/features/register/actions.ts` and awaits it. We formalize that into a single port that
every cash-path feature calls **instead of** touching `src/lib/db.ts` directly. The edition
switch then just selects which implementation is constructed at the composition root.

- **Cloud impl — `PrismaDataStore`** (`src/lib/data-store/prisma-store.ts`): wraps the
  existing `db.*` calls / server actions against Neon. Behavior-preserving.
- **Local impl — `SqliteDataStore`** (`src/lib/data-store/sqlite-store.ts`): hand-written SQL
  over `@tauri-apps/plugin-sql`, single SQLite file in the app data dir.

Types reuse the projections already defined in the current `queries.ts` files
(`SellableEntry`, `ManagedCatalog`, `OrderReceipt`, `OrderRow`, `DailyReport`,
`DrawerSessionRow`). `businessId` stays in every signature — in local it collapses to a
fixed seeded constant, so the cloud impl is unchanged and the tenant CI guard still holds.

```ts
// src/lib/data-store/types.ts
export interface DataStore {
  // ── Catalog (read) — src/features/catalog/queries.ts:41,135 ──
  getRegisterCatalog(businessId: string): Promise<SellableEntry[]>;
  getManagedCatalog(businessId: string): Promise<ManagedCatalog>;
  resolveVariations(businessId: string, variationIds: string[]): Promise<ResolvedVariation[]>; // src/features/register/resolve-lines.ts:91
  getTaxConfig(businessId: string): Promise<{ taxRateBps: number; taxInclusive: boolean }>;

  // ── Checkout / order write (cash-only) — src/features/register/actions.ts:94 ──
  findOrderByClientUuid(businessId: string, clientUuid: string): Promise<OrderReceipt | null>;
  // ONE atomic op: allocate next per-business order number + insert Order+OrderLine[]+Payment.
  // Postgres: OrderCounter upsert inside db.$transaction. SQLite: BEGIN IMMEDIATE (single-writer).
  commitSale(input: CommitSaleInput): Promise<OrderReceipt>;

  // ── Orders (read) — src/features/orders/queries.ts:24,322 ──
  listOrders(businessId: string, limit?: number): Promise<OrderRow[]>;
  getOrderReceipt(businessId: string, orderId: string): Promise<OrderReceipt | null>;

  // ── Drawer — src/features/cash-drawer/{queries,actions}.ts ──
  getOpenDrawerSession(businessId: string): Promise<DrawerSessionRow | null>;
  openDrawer(businessId: string, openedById: string, openingFloatCents: number): Promise<DrawerSessionRow>;
  getCashCollectedSince(businessId: string, openedAt: Date, end: Date): Promise<number>; // src/features/cash-drawer/queries.ts:82
  closeDrawer(businessId: string, sessionId: string, countedCents: number): Promise<DrawerSessionRow>;
  listDrawerSessions(businessId: string, limit?: number): Promise<DrawerSessionRow[]>;
  getDrawerDaySummary(businessId: string, start: Date, end: Date): Promise<DrawerDaySummary>;

  // ── Daily / Z-report (read) — src/features/orders/queries.ts:86 ──
  getDailyReport(businessId: string, start: Date, end: Date): Promise<DailyReport>;
  getItemSalesReport(businessId: string, start: Date, end: Date): Promise<ItemSalesReport>;      // optional
  getCashierSalesReport(businessId: string, start: Date, end: Date): Promise<CashierSalesRow[]>; // optional

  // ── Local operator/PIN (cloud: backed by Membership; local: Operator table) ──
  listOperators(businessId: string): Promise<OperatorRow[]>;
  verifyOperatorPin(businessId: string, operatorId: string, pin: string): Promise<boolean>;
}
```

**Seam design rules (load-bearing):**

1. `commitSale` is **one method, not `allocateNumber()` + `createOrder()`.** Correctness rests
   on allocate-number-and-insert being atomic (the `OrderCounter` upsert lives *inside*
   `db.$transaction` in `src/features/register/actions.ts`; the order-number-race fix depends
   on it). Each backend honors atomicity its own way — Postgres row-lock vs SQLite
   `BEGIN IMMEDIATE` (SQLite is single-writer, so the race cannot even occur) — while the seam
   shape is identical.
2. Feature code runs the pure `resolveOrderLines` → `computePricedOrder` validation **before**
   calling `commitSale`, so all money math is shared and server-authoritative in both editions.
3. `getCashCollectedSince` and `getDailyReport` must key on **payment time** and use
   `Business.timezone` for day boundaries verbatim, so drawer-expected stays equal to Z-report
   cash by construction in both stores.
4. Local edition drops from the seam: QR/MANUAL tender branches, the manager-approval gate
   (`src/features/register/manager-approval.ts` — cash is never gated), the offline
   `priceSnapshot`/forgery-floor relaxation, Stripe, and `emailReceipt`.

---

## 3. Offline desktop stack recommendation

**Shell: Tauri v2** (over Electron). Rationale one-liners:

| Piece | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri v2** | Sub-10 MB signed installer vs Electron's ~100–180 MB; native OS WebView (WebView2 already on Win 11); Rust core gives OS-level device access, which is the whole reason printing works (§ below). |
| Frontend build | Next.js `output: 'export'` static bundle | No Node server at runtime; offline single-tenant needs no RSC request-time data — pages fetch through the `DataStore` seam. This is the one real porting task (server actions → Tauri commands behind `isLocal`). |
| Local DB | `tauri-plugin-sql` (`features=["sqlite"]`, sqlx-backed) + `@tauri-apps/plugin-sql` | Ships the SQLite driver inside the Rust binary — no native-module rebuild tax; supports migrations. Integer cents/bps are exact (SQLite `INTEGER` = 64-bit). |
| Printer + drawer transport | **native Rust `print_raw(target, bytes)`** backed by the `escpos` crate drivers (Network 9100 / Windows spooler `WritePrinter` RAW / native `usbprint.sys` / serial), reusing `escpos.ts` bytes | Native path turns the Windows driver claim from a WebUSB blocker into the supported transport — no Zadig/WinUSB swap. The byte formatter is untouched; only the transport is new. |
| Cash-drawer kick | same `print_raw` channel, `drawerKick(pin)` / `formatReceipt({openDrawer:true})` bytes from `escpos.ts` | Drawer is a 24V solenoid slaved to the printer's RJ11 port; the `ESC p` pulse rides the exact same byte stream — no separate device. Expose a pin-2/pin-5 setting. |
| License verify (trust anchor) | `ed25519-dalek` v2 in a Rust `#[tauri::command]` at boot | JS webview is user-modifiable (DevTools); the Rust gate refuses to open/decrypt the SQLite store unless the signature verifies. `verify_strict` rejects Ed25519 malleability edge cases. |
| License UX check | Web Crypto `SubtleCrypto.verify('Ed25519', …)`, fallback `@noble/ed25519` (5 KB) | Renders friendly "unlicensed" state only — never the sole gate. |
| Settings / license blob storage | `tauri-plugin-store` + `$APPCONFIG/license.vlk` | Small KV for settings + license state; the blob is not a secret, only its signature matters. |
| Local secrets (PIN HMAC) | locally-generated device secret (not `BETTER_AUTH_SECRET`) | The operator-PIN HMAC in `src/lib/operator.ts` needs a local secret since Better Auth's is gone. |

### One-time signed license-key scheme

- **Ed25519 detached signature over a compact CBOR claims payload**, packaged
  `magic || len || payload || 64-byte sig`, Crockford-Base32 encoded, delivered as a
  downloadable `.vallalicense` file + copy-paste blob (too long to hand-type — which keeps
  real signature strength instead of a crackable checksum key).
- Claims: `{ v, id, p:"offline", iat, ex:null (perpetual), dev:null, sku }`. `dev`
  (device-binding) field is **reserved but OFF for v1** — binding requires a soft phone-home
  and turns hardware changes into $99 support tickets.
- **Signed only server-side** on vallahub.com: private key in `LICENSE_SIGNING_SK` env
  (zod-validated like `src/lib/env.ts`, never in the app/repo); only the 32-byte **public**
  key is compiled into the Rust core. Forging a key = forging Ed25519 = infeasible even after
  inspecting unlimited legitimate keys.
- **Issuance** reuses the existing Stripe pattern in `app/api/payments/webhook`: one-time
  Checkout → `checkout.session.completed` → verify signature → require `payment_status:'paid'`
  → sign claims → idempotent-upsert a `License` row keyed on `session.id` → deliver via Resend
  + success-page download. The desktop app never queries this DB.
- **Revocation is best-effort by design** (no phone-home): a signed embedded blocklist of
  abuser `id`s shipped inside app updates (offline CRL analog), checked by `is_revoked()` in
  the Rust verifier. Prevention at issuance is the primary control.

---

## 4. Sequenced build plan

### Stage 1 — Inert scaffold (zero cloud behavior change) ← START HERE

Files to CREATE:
- `src/lib/edition.ts` — the switch (§1). Pure `process.env` read, defaults to `cloud`.
- `src/lib/edition.test.ts` — asserts the cloud default + every derived flag under both editions.
- `docs/EDITIONS.md` — this document.

Files to MODIFY: **none.** Nothing imports `edition.ts` yet, and `EDITION` defaults to
`cloud`, so the hosted build is byte-for-byte unchanged. Verify: `npm run typecheck` +
`npm test` pass unchanged. Commit. **Shipped as PR (`feat/editions-scaffold`).**

> **Refinement vs. the original synthesis:** the `DataStore` interface
> (`src/lib/data-store/types.ts`) was moved from Stage 1 into **Stage 2**. Building the
> interface in isolation would force it to reference types that don't exist yet
> (`CommitSaleInput`, `OperatorRow`, …), so it can't be truly "inert + typechecked" on its
> own. It now lands with its first (`PrismaDataStore`) implementation, where TypeScript
> verifies the seam against real code.

### Stage 2 — Data-store seam + cloud adapter (behavior-preserving, additive on `main`)

**Stage 2a — READ seam (SHIPPED, PR `feat/editions-datastore-seam`).** Additive; nothing
consumes it yet, so cloud behavior is unchanged. `npm run typecheck` clean; 805 tests green.
- CREATE `src/lib/data-store/types.ts` — the `DataStore` interface, READ methods only,
  mirroring the real `queries.ts` signatures verbatim: `getRegisterCatalog`, `getManagedCatalog`,
  `listOrders`, `getOrderReceipt`, `getDailyReport`, `getItemSalesReport`, `getCashierSalesReport`,
  `getOpenSession`, `listDrawerSessions`, `getCashCollectedSince`, `getDrawerDaySummary`. All
  projection types are `import type`-only (no `server-only` runtime pulled in).
- CREATE `src/lib/data-store/prisma-store.ts` — `prismaDataStore: DataStore`, each method a 1:1
  delegate to the existing tenant-scoped query fn. The `: DataStore` annotation makes tsc prove
  the seam matches the real signatures.
- CREATE `src/lib/data-store/index.ts` — composition root `getDataStore()` (single cloud impl
  for now; Stage 3 branches on `isLocal`).

**Stage 2b — WRITE path (SHIPPED, PR `feat/editions-datastore-writes`).** Additive; still
inert. `npm run typecheck` clean; 805 tests green.
- EXTEND `DataStore` + `prismaDataStore` with the write path, mirroring the real signatures:
  `checkout(input: CheckoutInput): CheckoutResult` (the atomic allocate-number-and-insert
  commit — `CheckoutInput`/`CheckoutResult` from `register/schema.ts`), and
  `openDrawer(input: OpenDrawerInput)` / `closeDrawer(input: CloseDrawerInput)` (inputs from
  `cash-drawer/schema.ts`, results from `cash-drawer/actions.ts`). Local operator/PIN reads
  land with Stage 3.

**Caller-rewiring is deliberately deferred to Stage 5, not done here.** Reason: the write
boundary (`checkout`, `openDrawer`, `closeDrawer`) is a **server action invoked from the
client**, so "route callers through `getDataStore()`" is not a cloud refactor — it's an
edition-build concern. In the cloud build the server action already *is* the seam boundary; in
the local build (static export, no server) that same call must resolve to a local function. So
the swap happens where the local shell is built (Stage 5, edition-gated), avoiding churn +
risk on the live cloud write path now. The seam **contract** (this PR) is what Stage 3's
`SqliteDataStore` implements.

### Stage 3 — Local schema + SQLite store (hand-written SQL)

**Stage 3a — schema + driver port + flagship read (SHIPPED, PR `feat/editions-sqlite-store`).**
Additive/inert (nothing constructs the store yet — it needs the Tauri driver, Stage 5). tsc +
lint clean; 808 tests green (+3), real SQLite exercised via `node:sqlite` (zero new deps).
- CREATE `src/lib/data-store/sqlite/schema.ts` — `SCHEMA_SQL`: the cash subset as SQLite DDL
  (`business` settings row, a new tiny `operator` table replacing User/Membership,
  `order_counter`, catalog tables, `"order"`/`order_line`/`order_line_modifier`/`payment`,
  `cash_drawer_session`). Money = INTEGER cents, tax = INTEGER bps; enums→TEXT, bools→0/1,
  timestamps→ISO TEXT. Dropped: Better Auth tables, Membership/TimeEntry, Stripe/QR fields,
  floor/tabs, and `Membership.permissions String[]` (no SQLite scalar lists).
- CREATE `src/lib/data-store/sqlite/driver.ts` — the `SqlDriver` port (`select`/`execute`),
  which `@tauri-apps/plugin-sql`'s `Database` already matches. Keeps `SqliteDataStore` driver-
  agnostic → unit-testable now, Tauri-wired later.
- CREATE `src/lib/data-store/sqlite/sqlite-store.ts` — `SqliteDataStore implements DataStore`:
  `migrate()` + a real `getRegisterCatalog` (hand-written SQL → the exact `SellableEntry[]`
  shape the cloud query returns). Remaining methods are typed `notYet()` stubs (fail loudly).
- CREATE `src/lib/data-store/sqlite/sqlite-store.test.ts` — a `node:sqlite`-backed test driver;
  seeds a catalog and asserts shape/sort/scoping against real SQL.

**Stage 3b — order-history reads (SHIPPED, PR `feat/editions-sqlite-orders`).** `listOrders`
(recent-first + the first payment's method) and `getOrderReceipt` (lines + modifiers + payments
+ business snapshot, strictly tenant-scoped) implemented against the SQLite schema and tested
end-to-end (seed an order → read it back). tsc + lint clean; 812 tests green.

**Stage 3c — the rest of the store (SHIPPED, PR `feat/editions-sqlite-store-rest`).** Completes
`SqliteDataStore`, all tested end-to-end via `node:sqlite` (zero new deps; 830 tests green, tsc +
lint clean).
- Reads: `getManagedCatalog` (categories + active/archived items + variations + modifier groups),
  `getDailyReport` (Z-report — same reconciliation semantics as cloud: payment-time windows,
  status-agnostic movements incl. negative refund reversals, proportional refund back-out, tender
  verified/unverified classification), `getItemSalesReport`, `getCashierSalesReport`, and the four
  drawer reads (`getOpenSession`, `listDrawerSessions`, `getCashCollectedSince`,
  `getDrawerDaySummary`).
- Writes: `checkout` — resolves lines against the local catalog, prices via the SHARED pure engine
  (`computePricedOrder`/`validateGroupSelection`, so money/tax is byte-for-byte identical to
  cloud), idempotent on `clientUuid`, and does allocate-order-number + insert
  Order/OrderLine[]/OrderLineModifier[]/Payment as one atomic unit under `BEGIN IMMEDIATE` (SQLite
  is single-writer, so the order-number race can't occur). Drops the cloud-only manager-approval
  gate and offline price-snapshot relaxation (local is cash-only, single-tenant, no replay queue).
  Plus `openDrawer`/`closeDrawer` (reuses the shared `reconcile`).
- Local operator/PIN + first-run seed: `listOperators`, `verifyOperatorPin` (reuses the shared
  scrypt `verifyPin` verbatim), `seedFirstRun` (idempotent — one `business` + `operator` + zeroed
  `order_counter`, pinned `LOCAL_BUSINESS_ID`). These are `SqliteDataStore`-only methods (NOT on
  the shared `DataStore` interface — the cloud backs operators with Better Auth + Membership), so
  the cloud impl + tenant CI guard stay untouched.
- Schema timestamp DEFAULTs now emit ISO-8601 UTC (`strftime('%Y-%m-%dT%H:%M:%fZ')`) so date-range
  string comparisons are lexicographically correct even for a default-filled row.

Operator ATTRIBUTION (`Order.cashierId` / drawer `openedById`) is left null in the store — the
active-operator context is wired at the local shell auth boundary (Stage 4/5, PIN-only). `index.ts`
starts returning `SqliteDataStore` when `isLocal` **once the Tauri driver exists (Stage 5)** — it
can't be constructed before then.

### Stage 4 — Local auth + env branch (SHIPPED, PR `feat/editions-local-auth-env`)

Runtime edition-branch of the auth/env seam. All gated on `isLocal` (default cloud), so the cloud
build is byte-for-byte unchanged; 837 tests green, tsc + lint clean.

- **`src/lib/edition.ts`** — added the fixed single-tenant identifiers `LOCAL_BUSINESS_ID` (`"local"`)
  and `LOCAL_USER_ID` (`"local-user"`) as plain constants (a tiny pure module both the SQLite store
  and `tenant.ts` share without heavy deps). `sqlite-store.ts` now re-exports `LOCAL_BUSINESS_ID`
  from here (single source of truth).
- **`src/lib/env.ts`** — schema branches on `isLocal`: the cloud-required vars (`DATABASE_URL`,
  `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`) collapse to harmless `.default()`
  placeholders in local (so a machine that never set them boots) while their inferred TYPE stays
  `string` — the cloud consumers (`auth.ts` etc.) compile + behave identically. Added the optional
  `VALLA_LOCAL_DEVICE_SECRET` (local operator-PIN HMAC). The production Upstash fail-fast is gated
  `!isLocal` (a cloud/serverless brute-force concern that must never trip the desktop app).
- **`src/lib/tenant.ts`** — when `authMode === "pin-only"`, `requireMembership`/`requireSession`
  return the fixed single-operator OWNER `TenantContext` (scoped to the caller's `businessId`)
  WITHOUT calling `auth`/`db` (proven by tests that stub both to throw). Cloud path unchanged.
- **`src/lib/operator.ts`** — the cookie-HMAC key comes from `VALLA_LOCAL_DEVICE_SECRET` (dev
  fallback) in local, `BETTER_AUTH_SECRET` in cloud.
- `src/features/employees/pin.ts` (scrypt) is already reused verbatim by the store's
  `verifyOperatorPin` (Stage 3c).

**Deferred to Stage 5 (bundling, not runtime):** tree-shaking `auth.ts`/`auth-client.ts`/`redis.ts`
and `/api/auth/*` OUT of the local build — that needs the `output: 'export'` + edition-gated
(dynamic) imports machinery Stage 5 builds. Here those modules simply aren't *called* when local.
The client-side operator PIN lock (the local shell can't use `next/headers` cookies) is likewise a
Stage 5 concern; `operator.ts`'s edition-aware secret is the defensive groundwork.

### Stage 5 — Tauri shell + native printer transport

**Stage 5a — seam wiring + shell scaffold (SHIPPED, PR `feat/editions-tauri-seam`).** The
additive, dep-free, fully unit-tested TypeScript that connects the store + printer to the (future)
Tauri runtime, plus the reviewable Rust scaffold. Cloud byte-for-byte unchanged; 851 tests green,
tsc + lint clean.
- `src/lib/data-store/sqlite/tauri-driver.ts` — `createTauriSqlDriver(db)` adapts
  `@tauri-apps/plugin-sql`'s `Database` to the store's `SqlDriver` port (declares only the minimal
  `TauriSqlDatabase` shape → NO `@tauri-apps` dependency; tested against a `node:sqlite`-backed
  fake). Plus `toPositionalDollarSql` for the `$n`-placeholder driver variant.
- `src/lib/data-store/local.ts` — `createLocalDataStore(driver)` (client-safe, NOT `server-only`):
  the LOCAL composition root — migrate + first-run seed → ready store. Proven end-to-end (a real
  cash sale round-trips through the Tauri-shaped driver in tests).
- `src/features/peripherals/transports/tauri.ts` — `createTauriPrinter(invoke, target)`: forwards
  ESC/POS bytes to the Rust `print_raw` command via an INJECTED `invoke` (no `@tauri-apps` dep;
  mirrors the injectable `usb` in `webusb.ts`). `kickDrawer` reuses the shared `escpos.drawerKick`.
- `src/features/peripherals/auto-print.ts` — `printOrderById`/`printOrderReceipt`/
  `buildOrderReceiptBytes`: the auto-print-on-sale chain
  (`getReceipt → fromOrderReceipt → formatReceipt({openDrawer,cut}) → printer.print`), pure +
  injected, fully tested.
- `src-tauri/` — Tauri v2 Cargo scaffold: `Cargo.toml` (tauri, tauri-plugin-sql[sqlite],
  tauri-plugin-store), `src/lib.rs` (the `print_raw` TCP-9100 path + `open_drawer`; Windows-spooler
  and serial paths are loud TODO stubs), `src/main.rs`, `build.rs`, `tauri.conf.json`,
  `capabilities/default.json`, `README.md`. **NOT `cargo build`-verified** (no local Rust
  toolchain) — see `src-tauri/README.md`.
- `next.config.ts` — gates `output: 'export'` + `images.unoptimized` + skips Serwist/`headers()`
  for the local build (`NEXT_PUBLIC_VALLA_EDITION=local`); the cloud build (default) is unchanged.
  Added `dev:local`/`build:local` npm scripts (POSIX env-prefix — Windows uses Git Bash/cross-env).

**Stage 5b — the runtime finish (DEFERRED, needs the toolchain + a real device).** These can only
be done/verified on a machine with Rust + Tauri (and are cloud-render-risky, so they stay gated):
- `cargo build` the shell (resolves `Cargo.lock`); `npx tauri icon` for `icons/`; add the JS deps
  `@tauri-apps/api` + `plugin-sql` + `plugin-store` (pinned, with lockfile).
- Convert the cash-path `page.tsx` shells from server-fetch to CLIENT-fetch through the seam (a
  static export bans server actions/middleware/request-time RSC) — gated on `isLocal` so the cloud
  build keeps its server render path. Wire the register to `createLocalDataStore` + call
  `printOrderById` after checkout (auto-print on by default in local), and swap the native
  transport into `DevicesManager.tsx`.
- The real one-liners that inject `@tauri-apps/plugin-sql`'s `Database` and `@tauri-apps/api/core`'s
  `invoke` into the adapters above.

### Stage 6 — License gate + issuance

**Stage 6a — license format + verifier core (SHIPPED, PR `feat/editions-license-core`).** The
shared, fully-tested Ed25519 license format + the Rust gate scaffold. Additive; cloud unchanged.
- `src/lib/license/license.ts` — the wire format (`"VLK1" ‖ version ‖ len ‖ payload ‖ sig(64)`,
  Crockford-Base32), canonical claims encode/decode, `packLicense`/`unpackLicense`, and
  crypto-INJECTED `signLicense`/`verifyLicense` (structure → signature → claims → version → expiry
  → revocation, signature checked before the payload is trusted). Payload is canonical JSON (not
  CBOR) so BOTH the TS signer and the Rust `serde_json` verifier parse identical bytes with no CBOR
  dep. Perpetual (`ex:null`) + reserved-off device binding (`dev:null`) per §3.
- `src/lib/license/webcrypto.ts` — WebCrypto Ed25519 injectors: `webcryptoEd25519Verifier`
  (32-byte raw public key, webview UX gate) + `webcryptoEd25519Signer` / `importEd25519PrivateKey`
  (vallahub signer). 13 tests: base32 round-trip, pack/unpack, sign→verify, wrong-key/tamper →
  `bad_signature`, expiry, revocation.
- `src-tauri/src/license.rs` — `verify_license` via `ed25519-dalek` `verify_strict` (the REAL trust
  anchor — the JS verify is UX only), byte-compatible with the TS format; wired as the
  `check_license` Tauri command. `ed25519-dalek = "2"` added to `Cargo.toml`. Embedded `PUBLIC_KEY`
  is a zero placeholder to replace before shipping. **Not `cargo build`-verified.**

**Stage 6b — the gate wiring + issuance (DEFERRED, needs the running local app + the vallahub
site).**
- Gate the SQLite open on `check_license`; a license entry screen before the PIN lock;
  `$APPCONFIG/license.vlk` load/store; the signed embedded revocation blocklist.
- `app/(app)/layout.tsx` local branch: replace the `getSession`→`/sign-in` redirect with the
  license gate → operator PIN lock (gated on `isLocal`).
- **vallahub.com issuance** (separate site): a `LICENSE_SIGNING_SK` (zod-validated, PKCS#8) →
  `importEd25519PrivateKey` → `signLicense`, driven by a one-time Stripe Checkout →
  `checkout.session.completed` webhook (reuse the `app/api/payments/webhook` pattern) → `License`
  DB row keyed on `session.id` → Resend delivery + success-page download. The shared
  `src/lib/license/` module above is exactly what the signer calls.

### Stage 7 — Packaging + signing + release

**Stage 7a — release pipeline + docs (SHIPPED, PR `feat/editions-desktop-release`).**
- `.github/workflows/desktop-release.yml` — a `tauri-apps/tauri-action` matrix build
  (`windows-latest` + `macos-latest` arm64 + `macos-13` x64) that drafts a GitHub Release with
  the `.msi`/NSIS + `.dmg` installers. Triggers on a `v*` tag or manual dispatch **only** —
  INDEPENDENT of the `quality` CI, never runs on `pull_request`, so it can't gate a merge. Sets
  `NEXT_PUBLIC_VALLA_EDITION=local` and threads the macOS notarization secrets.
- `docs/RELEASING.md` — the operational checklist: the Stage 5b/6b prerequisites the build needs,
  the signing matrix + costs (Azure Trusted Signing ~$10–12/mo **or** OV ~$220/yr for Windows;
  Apple Developer $99/yr — year-1 ≈ $220–320), the cut-a-release steps, and the best-effort
  no-phone-home revocation flow.

**Stage 7b — the actual release (needs the toolchain + certs + a human).** Run once the Stage
5b/6b prerequisites land: buy/configure the signing certs + set the Actions secrets, replace the
license `PUBLIC_KEY`, tag `vX.Y.Z`, review the drafted Release, publish, and link the installers
from vallahub.com. Ship a **Test print / Open drawer** diagnostic in local Settings → Devices
(reuses the native Tauri transport).

---

## 5. Risks + open decisions

- **Prisma-on-SQLite vs hand-written SQL.** Recommended: `output:'export'` frontend + a
  hand-written `SqliteDataStore` behind the seam (keeps the Tauri bundle small, reuses the
  correctness-critical pure logic + React islands). Flipping the Prisma provider (Option B)
  maximizes raw reuse but ships Node + Next standalone + the ~120–180 MB Prisma engine binary
  and a sidecar-process lifecycle, which negates the reason to pick Tauri. **Decision needed:
  confirm Option A before Stage 3.** Either way, `Membership.permissions String[]` has no
  SQLite equivalent and must be dropped/JSON-ified.
- **`Order.cashierId` / `CashDrawerSession.openedById` dangling refs.** They point at the
  dropped `Membership`. Recommended: a tiny local `Operator` table (Stage 3) preserves the
  "who rang this / who opened the drawer" audit trail; the minimal alternative is free-text.
- **Windows printing.** Prefer spooler `WritePrinter` RAW against a **Generic/Text-Only**
  installed driver, or the escpos crate's native `usbprint.sys` path. **Avoid the WebUSB/Zadig
  route** — a per-machine manual driver swap that breaks normal printing is a support nightmare
  for a shipped $99 product. Offer TCP 9100 as a first-class option.
- **macOS printing.** Use **CUPS (`lp -o raw`)**, not raw libusb (kernel-detach + entitlement
  pain). App must be signed + notarized or Gatekeeper blocks it.
- **iOS / hardware limits.** No iOS/iPadOS target for the offline edition — the license +
  native-printer + local-SQLite model assumes a desktop OS with full device access. Mobile
  stays cloud/PWA only.
- **Code-signing cost + eligibility.** Azure Trusted Signing onboarding was limited to US/CA
  orgs with 3+ years history (individual validation "coming soon" mid-2025); if VallaPOS
  doesn't qualify, fall back to an OV cert (~$220/yr). Year-1 signing ≈ $220–320.
- **Refund / revocation.** With no phone-home, an installed copy keeps working after a
  chargeback until it updates. Mitigation: gate issuance on `payment_status:'paid'`, mark the
  `License` row revoked on `charge.dispute.created`, and add the `id` to the next signed
  embedded blocklist. Treat escaped chargebacks as cost of doing business, not an engineering
  problem. **Decision needed: perpetual `ex:null` vs soft-expiring keys** — recommend perpetual.
- **Static export vs server actions.** `output:'export'` bans server actions, middleware
  (where the cloud CSP lives), and request-time RSC data reads. Cash-path `page.tsx` shells
  must become client-fetch through the seam. The heavy islands (`Register.tsx`) are already
  client components, so this is a shell rewrite, not a logic rewrite — but it must be gated on
  `isLocal` so the cloud build keeps its server actions + middleware.
- **Device-binding.** Reserved (`dev` field) but OFF for v1. Revisit only if piracy measurably
  bites; a $99 one-time product favors honesty-plus-UX over DRM friction.
