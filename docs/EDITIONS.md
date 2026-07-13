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

### Stage 3 — Local schema + SQLite store

- CREATE `prisma/schema.local.prisma` (or provider-swapped variant) — SQLite provider, cash
  subset only: `Business` (settings row), `OrderCounter`, `Category`, `Item`, `Variation`,
  `ModifierGroup`, `Modifier`, `ItemModifierGroup`, `Order`, `OrderLine`, `OrderLineModifier`,
  `Payment` (CASH-only in code), `CashDrawerSession`, plus a new small `Operator`
  (id, name, `pinHash`, active) replacing `User`/`Membership`. Drop `User`/`Session`/`Account`/
  `Verification`/`Membership`/`TimeEntry`, all Stripe/QR fields, and `FloorRoom`/`FloorTable`/
  `OrderTable`. Remove `Membership.permissions String[]` (no SQLite scalar lists).
- CREATE `src/lib/data-store/sqlite-store.ts` — `SqliteDataStore implements DataStore` over
  `@tauri-apps/plugin-sql`; ~20 hand-written SQL statements, `commitSale` under `BEGIN IMMEDIATE`.
- CREATE migration `.sql` files shipped with the app; seed one `Business` + one `Operator` at
  first run and pin the `businessId` constant.
- MODIFY `src/lib/data-store/index.ts` — return `SqliteDataStore` when `isLocal`.

### Stage 4 — Local auth + env branch

- MODIFY `src/lib/env.ts` — branch schema on `isLocal`: `DATABASE_URL` becomes a SQLite path,
  `BETTER_AUTH_*`/Upstash optional, skip the production Upstash fail-fast block when local.
- MODIFY `src/lib/tenant.ts` — when `authMode === "pin-only"`, `requireSession`/
  `requireMembership` return the single fixed local `TenantContext` without calling
  `auth.api.getSession`.
- MODIFY `src/lib/operator.ts` — source the HMAC secret from the local device secret when local.
- REUSE `src/features/employees/pin.ts` (scrypt) verbatim for `verifyOperatorPin`.
- Ensure `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/redis.ts`, and `/api/auth/*` do
  not load in the local build.

### Stage 5 — Tauri shell + native printer transport

- CREATE `src-tauri/` (Cargo project): `tauri`, `tauri-plugin-sql` (sqlite), the `escpos`
  crate, `tauri-plugin-store`, `ed25519-dalek`.
- CREATE Rust command `print_raw(target, bytes)` (Network 9100 / Windows spooler RAW / native
  `usbprint.sys` / serial) + `open_drawer`.
- CREATE `src/features/peripherals/transports/tauri.ts` — a `PeripheralDevice` implementation
  satisfying the existing `types.ts` contract, calling `print_raw`; swap it in at
  `src/features/peripherals/components/DevicesManager.tsx` for the local build.
- MODIFY `next.config.ts` — `output: 'export'` for the local build; convert the cash-path
  `page.tsx` shells from server-fetch to client-fetch through the seam.
- WIRE checkout to `getOrderReceipt` → `fromOrderReceipt` → `formatReceipt({openDrawer,cut})`
  → `print_raw` (auto-print on sale, on by default in local).

### Stage 6 — License gate + issuance

- CREATE `src-tauri/src/license.rs` — Ed25519 `verify_license` at boot; gate SQLite open on it.
- CREATE license entry screen (blocks before the PIN lock) + `$APPCONFIG/license.vlk` load.
- CREATE vallahub.com issuance: `LICENSE_SIGNING_SK` env, Stripe one-time Checkout + webhook
  fulfillment (reuse `app/api/payments/webhook` pattern), `License` DB row, Resend delivery,
  signed blocklist build.
- MODIFY `app/(app)/layout.tsx` — local branch replaces the `getSession`→`/sign-in` redirect
  with the license gate, then falls through to the operator PIN lock.

### Stage 7 — Packaging + signing + release

- `tauri build` → `.msi`/NSIS (Win) + `.dmg` (Mac). Windows sign via Azure Trusted Signing
  (~$10–12/mo) or an OV cert (~$220/yr); macOS Developer ID + `notarytool` staple ($99/yr Apple).
- Ship a "Test print / Open drawer" diagnostic in local settings. Distribute from vallahub.com.

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
