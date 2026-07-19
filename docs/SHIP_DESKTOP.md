# SHIP_DESKTOP.md — Turnkey checklist to ship the offline desktop edition

Companion to `docs/EDITIONS.md` (architecture) and `docs/RELEASING.md` (signing/release ops).
This is the **file-level execution package** for the three remaining phases: **5b** app
wiring, **6b** license gate + vallahub issuance, **7b** sign/release. Everything else
(Stages 1–4, 5a, 6a, 6b-core, 7a) is **merged** — see "Already done" below and don't redo it.

The edition switch is `NEXT_PUBLIC_VALLA_EDITION=local` (`src/lib/edition.ts`). Default is
`cloud`, so all wiring below is gated on `isLocal` and cannot touch the hosted build.

---

## ⚠️ Callout — what CANNOT be done headlessly (real machine / human / money)

| Item | Needs | Why |
|---|---|---|
| `cargo build` / `npx tauri dev` / `tauri build` | **Rust + Tauri toolchain on a real OS** | No Rust toolchain here; `src-tauri/` was authored but is **NOT `cargo build`-verified** (`src-tauri/README.md`). |
| `npx tauri icon …` → `src-tauri/icons/` | **Machine w/ Tauri CLI + a logo PNG** | Icon set is generated, not committed. |
| Test print / open cash drawer | **Real thermal printer + drawer (Epson/Star)** | The native `print_raw` TCP-9100 path and Windows-spooler/serial stubs (`src-tauri/src/lib.rs:57,61`) can only be validated against hardware. |
| Windows code-signing cert | **MONEY + org identity** (Azure Trusted Signing ~$10–12/mo *or* OV ~$220/yr) | Purchase + eligibility (US/CA org, 3+ yr history for Azure). |
| Apple Developer ID + notarization | **MONEY $99/yr + Apple account** | Gatekeeper blocks unsigned/un-notarized apps. |
| Generate the Ed25519 license keypair | **HUMAN secret custody** | Private half becomes `LICENSE_SIGNING_SK` on vallahub; public half is compiled into the app. Never in repo. |
| Buy/stand up **vallahub.com** + deploy issuance site | **MONEY (domain/host) + human** | Separate site; Stripe + Resend live keys. |
| Set GitHub Actions signing secrets | **HUMAN w/ repo admin + the certs** | Secrets can't be scripted from here. |
| Tag `vX.Y.Z`, review + publish the drafted Release | **HUMAN judgment** | Publishing distributes signed binaries. |

**What a future headless TS session CAN do** (no toolchain/money/hardware): the entire
Phase 5b **TypeScript** wiring (page.tsx conversions, seam/printer injection one-liners,
`getDataStore()` edition branch, `DevicesManager` transport swap, Test-print UI *code*), the
Phase 6b **in-app gate TS** (`layout.tsx` license branch, license entry screen) and the full
**vallahub issuance app source** (API route + webhook + success page + Prisma `License`
model), edit the Rust `PUBLIC_KEY` constant, and bump versions. Those are code; they just
can't be *built/signed/run* headlessly.

---

## Already done (merged — DON'T redo)

- **Stage 1–2b** — edition switch `src/lib/edition.ts`; the `DataStore` seam `src/lib/data-store/types.ts` + cloud `prismaDataStore` (`src/lib/data-store/prisma-store.ts`) + `getDataStore()` (`src/lib/data-store/index.ts`); full read+write contract.
- **Stage 3a–3c** — complete `SqliteDataStore` (`src/lib/data-store/sqlite/sqlite-store.ts`), DDL (`sqlite/schema.ts`), driver port (`sqlite/driver.ts`), plus store-only `listOperators`/`verifyOperatorPin`/`seedFirstRun`. Tested end-to-end via `node:sqlite` (830+ tests green).
- **Stage 4** — `edition.ts` `LOCAL_BUSINESS_ID`/`LOCAL_USER_ID`; `src/lib/env.ts` local placeholders + `VALLA_LOCAL_DEVICE_SECRET`; `src/lib/tenant.ts` pin-only `requireMembership`/`requireSession` returns fixed OWNER context; `src/lib/operator.ts` local HMAC secret.
- **Stage 5a** — `sqlite/tauri-driver.ts` (`createTauriSqlDriver`), `data-store/local.ts` (`createLocalDataStore`), `transports/tauri.ts` (`createTauriPrinter`), `auto-print.ts` (`printOrderById`/`printOrderReceipt`/`buildOrderReceiptBytes`), `src-tauri/` Cargo scaffold, `next.config.ts` local branch (`output:'export'`), `dev:local`/`build:local` scripts.
- **Stage 6a + 6b-core** — license format/verifier `src/lib/license/license.ts` (`packLicense`/`unpackLicense`/`signLicense`/`verifyLicense`), `webcrypto.ts` (`webcryptoEd25519Verifier`/`Signer`/`importEd25519PrivateKey`), `gate.ts` (`resolveLicenseState`/`isLicensed`), `store.ts` (`createLicenseStore`), `issue.ts` (`issueLicense`/`buildLicenseClaims`), Rust `src-tauri/src/license.rs` (`verify_license`/`check_license`).
- **Stage 7a** — `.github/workflows/desktop-release.yml` (matrix build, `v*`-tag/dispatch only, independent of `quality` CI); `docs/RELEASING.md`.

---

## 0. Prerequisites — machine / accounts / hardware

### 0.1 Machine toolchain (one dev box, Win 11 primary target)
- [ ] Install **Rust** (`rustup`, stable) + the MSVC build tools (Windows) — `cargo --version` works.
- [ ] Install **Tauri v2 CLI**: `npm i -D @tauri-apps/cli` (pin exact; commit lockfile — CI runs `npm ci`).
- [ ] WebView2 runtime present (default on Win 11) — no action on this box.
- [ ] (macOS targets) Xcode command-line tools; CI runners cover the actual mac builds.

### 0.2 Accounts / money
- [ ] Windows signing: **Azure Trusted Signing** account (US/CA org, 3+ yr history) *or* buy an **OV code-signing cert** (~$220/yr) if ineligible.
- [ ] **Apple Developer Program** membership ($99/yr) → Developer ID Application cert + app-specific password for `notarytool`.
- [ ] **vallahub.com** domain + a host (reuse Vercel + Neon + Stripe + Resend patterns from this repo).
- [ ] Stripe account with a **one-time** ($99) Checkout price for the desktop SKU; Resend API key.

### 0.3 Hardware for acceptance
- [ ] An Epson/Star **ESC/POS thermal printer** reachable over TCP:9100 (and/or Windows spooler) + an RJ11 cash drawer, to validate `print_raw`/`open_drawer`.

### 0.4 Secrets to generate (human, offline)
- [ ] Generate an **Ed25519 keypair**. Private → `LICENSE_SIGNING_SK` (PKCS#8, zod-validated) on vallahub only. Public 32 bytes → compiled into the app (Rust `PUBLIC_KEY` + the webview verifier).

---

## 1. Phase 5b — App wiring (static export through the seam)

Goal: `npm run build:local` emits a working `out/` that the Tauri shell (`frontendDist:"../out"`, `src-tauri/tauri.conf.json:7`) loads. `output:'export'` (`next.config.ts:63`) **bans** server actions, middleware, and request-time RSC — so every cash-path `page.tsx` must fetch **client-side through the seam**, gated on `isLocal`.

### 1.1 Dependencies — placement decision
The `@tauri-apps/*` JS packages are **runtime deps of the local build only**, but the cloud
build must never bundle them. They are safe to add to the single `package.json` `dependencies`
because they're referenced only from `isLocal`-gated dynamic imports (tree-shaken out of the
cloud bundle) — matching how `next.config.ts` already reads `process.env.NEXT_PUBLIC_VALLA_EDITION`
without importing edition TS. **Decision: one root `package.json`, exact-pinned, no separate
workspace.**

- [ ] `npm i @tauri-apps/api @tauri-apps/plugin-sql @tauri-apps/plugin-store` (runtime; pin exact).
- [ ] `npm i -D @tauri-apps/cli` (dev/build tool).
- [ ] Commit `package-lock.json` (CI `npm ci`).

### 1.2 Composition-root edition branch
`src/lib/data-store/index.ts` currently starts with `import "server-only"` and always returns
`prismaDataStore` — that module CANNOT be bundled into the static export. Route the local build
around it:
- [ ] Add an **`isLocal`-gated dynamic import** so the local store is constructed from a **client-safe** entry (`src/lib/data-store/local.ts`'s `createLocalDataStore`, which is intentionally NOT `server-only`), and the `server-only` `prisma-store.ts` is only reached in cloud. Keep the cloud `getDataStore()` path byte-for-byte.
- [ ] Wire the local driver one-liner: `createTauriSqlDriver(await Database.load("sqlite:vallapos.db"))` (`@tauri-apps/plugin-sql`) → `createLocalDataStore(driver)` → ready `LocalDataStore`. (`src/lib/data-store/sqlite/tauri-driver.ts:38`, `local.ts:31`.)

### 1.3 page.tsx conversion table (server-fetch → client-fetch through the seam)
Every row is a **server component that awaits `requireMembership` + `db.business.findUnique` +
feature queries today**. In local, `requireMembership` already returns the fixed OWNER context
(Stage 4, `src/lib/tenant.ts`), but the `db.*`/query calls must be replaced by seam calls run in
a client island. Convert each into a thin client shell (`"use client"` + `useEffect`/loader) that
reads from the local `DataStore`; keep the cloud server path untouched via an `isLocal` fork
(separate `*.local.tsx` island or a branch inside the page).

| Route (`app/(app)/…`) | Cloud server fetch today | Seam method to call in local | Notes |
|---|---|---|---|
| `[businessId]/register/page.tsx` | `db.business.findUnique(tax/currency/qr/stripe)` + `getRegisterCatalog` (`register/page.tsx:18,34`) | `getRegisterCatalog` + `getTaxConfig` | Drop `qrPay`/`stripeQrEnabled` (`paymentsEnabled===false` in local, cash-only). After `checkout`, call `printOrderById` (§1.4). |
| `[businessId]/drawer/page.tsx` | `getRunningExpected`, `listDrawerSessions` (`drawer/page.tsx:5,41,42`) | `getOpenSession`, `getDrawerDaySummary`, `listDrawerSessions` | Drop `pageHasCapability`/`roleAtLeast` gate (single OWNER operator). |
| `[businessId]/orders/page.tsx` | `listOrders` (`orders/page.tsx:6,30`) | `listOrders` | — |
| `[businessId]/orders/[orderId]/receipt/page.tsx` | `getOrderReceipt` (`receipt/page.tsx:6,30`) | `getOrderReceipt` | Add a **Reprint** action via `printOrderById` (§1.4). |
| `[businessId]/products/page.tsx` | `getManagedCatalog` (`products/page.tsx:4,25`) | `getManagedCatalog` | — |
| `[businessId]/reports/page.tsx` | `getDailyReport`,`getItemSalesReport`,`getCashierSalesReport`,`getDrawerDaySummary` (`reports/page.tsx:4,14`) | same four seam reads | CSV export is pure/shared. |
| `[businessId]/settings/page.tsx` | business + `DevicesManager` + payments/billing/floor (`settings/page.tsx`) | business settings only | **Drop** `PaymentsConnect`, `SubscriptionCard`, `FloorPlanEditor` in local; keep `DevicesManager`+`HardwareReadiness` (§1.5). |
| `[businessId]/employees/page.tsx` | `getActiveOperator`, member/timesheet queries (`employees/page.tsx`) | `SqliteDataStore.listOperators` / `verifyOperatorPin` | Local operator table, not Membership/TimeEntry. |
| `[businessId]/layout.tsx` | `requireMembership` (l.35) + `db.business.findUnique` (l.44) + billing gate (l.56–68) | fixed OWNER ctx (Stage 4) + **license gate**; keep existing `OperatorLock` (l.79–91) | See §2.1 (the license branch lands here). |
| `start/page.tsx` (onboarding) | `CreateBusinessForm` | **skip** — `seedFirstRun` seeds the single business/operator on first boot | No cloud-style create flow. |

- [ ] **Dynamic-route params.** `[businessId]` must resolve statically in export. Add `generateStaticParams` returning the single `LOCAL_BUSINESS_ID` (`"local"`, `src/lib/edition.ts`) for the local build so the register/orders/etc. routes pre-render one tenant.
- [ ] Confirm `npm run build:local` produces `out/` with those routes and **no** server-action/middleware errors.

### 1.4 Auto-print on sale
- [ ] In the register client, after `checkout` resolves, call `printOrderById({ store, orderId, printer, openDrawer: true })` (`src/features/peripherals/auto-print.ts:61`) — auto-print ON by default in local.
- [ ] Construct the printer once via `createTauriPrinter(invoke, target)` (`transports/tauri.ts:51`) where `invoke` is `@tauri-apps/api/core`'s `invoke` and `target` is the configured `NativePrintTarget` (TCP host:port / spooler name / serial).

### 1.5 Devices UI + Test-print diagnostic
- [ ] In `src/features/peripherals/components/DevicesManager.tsx`, add an `isLocal` branch that selects the **Tauri native transport** (`createTauriPrinter`) instead of WebUSB.
- [ ] Add a **Test print / Open drawer** button (Settings → Devices) that calls `buildOrderReceiptBytes`/`escpos.drawerKick` → `printer.print` / the `open_drawer` command (`docs/RELEASING.md` "Deferred UI").

---

## 2. Phase 6b — License gate (in-app) + vallahub issuance (separate site)

The **authoritative** gate is Rust `verify_license` (`src-tauri/src/license.rs:50`, `check_license`
command `lib.rs:85`); the webview `resolveLicenseState` is UX only.

### 2.1 In-app gate (local build)
- [ ] **Replace the `PUBLIC_KEY` placeholder.** `src-tauri/src/license.rs:20` is `const PUBLIC_KEY: [u8; 32] = [0u8; 32];` — swap in the real 32-byte Ed25519 public key (the one whose private half is `LICENSE_SIGNING_SK`). Also feed the same raw key to the webview verifier via `webcryptoEd25519Verifier(rawPublicKey)` (`src/lib/license/webcrypto.ts:17`).
- [ ] **Boot-gate the SQLite open** on the Rust `check_license` result: refuse to open/decrypt the store unless the signature verifies (call `check_license(blob, now_ms)` before `createLocalDataStore`).
- [ ] **License entry screen** (before the operator PIN lock): a client screen that
  - loads/saves the blob via `createLicenseStore(kv)` over the **`@tauri-apps/plugin-store`** KV (`$APPCONFIG/license.vlk`, `src/lib/license/store.ts:29`, key `LICENSE_STORE_KEY`),
  - evaluates `resolveLicenseState({ loadBlob, verify: webcryptoEd25519Verifier(pk), now, revokedIds })` (`gate.ts:26`) and renders licensed / unlicensed / invalid(reason).
- [ ] **`app/(app)/[businessId]/layout.tsx`** local branch (gated on `isLocal`): the cloud gate is `requireMembership()` in a try/catch where `AuthError → redirect("/sign-in")` (lines 34–42), followed by the billing gate (lines 56–68) and the `OperatorLock` PIN screen (lines 79–91). In local there is no `/sign-in` and no billing — so add the **license gate ahead of the existing `OperatorLock`**, rely on the fixed-OWNER context (Stage 4, so `requireMembership` won't throw `AuthError`), and skip the billing block. Cloud path byte-for-byte unchanged.
- [ ] **Embedded revocation blocklist**: ship the signed abuser-`id` list into `verify_license`'s `revoked: &[String]` arg (`license.rs:53,88`); refresh it via app updates (offline CRL).

### 2.2 vallahub.com issuance site (separate build)
Reuse this repo's `app/api/payments/webhook` pattern. The desktop app **never** queries this DB.
- [ ] `LICENSE_SIGNING_SK` env — PKCS#8 Ed25519 private key, **zod-validated** like `src/lib/env.ts`; never in the app/repo.
- [ ] Signer bootstrap: `importEd25519PrivateKey(pkcs8)` → `webcryptoEd25519Signer(privateKey)` → the injected `SignFn` (`src/lib/license/webcrypto.ts:26,31`). Copy `src/lib/license/{license,issue,webcrypto}.ts` into the vallahub app (shared format).
- [ ] One-time **Stripe Checkout** ($99) → `checkout.session.completed` webhook: verify signature, require `payment_status:'paid'`.
- [ ] Sign: `issueLicense({ sku: "vallapos-desktop", id: session.id, iat: Date.now() }, sign)` (`src/lib/license/issue.ts:46`) — perpetual (`ex` omitted → `null`), `dev:null`.
- [ ] Persist: idempotent-**upsert** a Prisma `License` row keyed on `session.id`.
- [ ] Deliver: **Resend** email + a success-page download of the `.vallalicense` blob.
- [ ] Chargeback path: on `charge.dispute.created`, mark the `License` row revoked and queue its `id` for the next signed embedded blocklist (§2.1).

---

## 3. Phase 7b — Sign / release

Workflow already exists: `.github/workflows/desktop-release.yml` (matrix `windows-latest` +
`macos-latest` arm64 + `macos-13` x64; sets `NEXT_PUBLIC_VALLA_EDITION=local`; `v*` tag / manual
dispatch only). It won't produce a working installer until §1–§2 land.

### 3.1 Toolchain / build resolution (real machine)
- [ ] `cargo build` (or `npx tauri build`) once locally to resolve **`src-tauri/Cargo.lock`**; commit it.
- [ ] `npx tauri icon path/to/vallapos-logo.png` → `src-tauri/icons/`; commit.
- [ ] Verify `npm run build:local && npx tauri build` yields a `.msi`/NSIS installer that launches, gates on license, and rings a cash sale end-to-end.

### 3.2 Placeholders to replace before shipping
- [ ] `src-tauri/src/license.rs:20` — real `PUBLIC_KEY` (see §2.1).
- [ ] `src-tauri/tauri.conf.json:4` `version` (currently `0.1.0`) → release version; keep in sync with `src-tauri/Cargo.toml`. `identifier` is `com.vallapos.desktop` (`tauri.conf.json:5`).
- [ ] Implement the two `print_raw` **TODO stubs**: Windows spooler RAW `WritePrinter` (`src-tauri/src/lib.rs:57`) and serial (`lib.rs:61`) — TCP-9100 path already works; validate against real hardware (§0.3).

### 3.3 Certs + costs (buy)
- [ ] **Windows** — Azure Trusted Signing (~$10–12/mo; needs US/CA org, 3+ yr history) **or** OV cert (~$220/yr). Unsigned ⇒ SmartScreen warnings.
- [ ] **macOS** — Apple Developer ID cert + `notarytool` staple ($99/yr). Un-notarized ⇒ Gatekeeper blocks.
- Year-1 signing budget ≈ **$220–320** (`docs/RELEASING.md`).

### 3.4 GitHub Actions secrets (repo admin)
- [ ] macOS notarization: `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
- [ ] Windows: configure per chosen provider (Azure Trusted Signing action **or** OV cert referenced in `tauri.conf.json`).

### 3.5 Tag + publish
- [ ] Bump `version` in `src-tauri/tauri.conf.json` (+ `Cargo.toml`).
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` (triggers the release workflow).
- [ ] Review the **drafted** GitHub Release (`.msi`/NSIS + `.dmg` artifacts), then **publish**.
- [ ] Link the installers from **vallahub.com**'s download/success page.
- [ ] Smoke test each published installer on a clean machine: install → enter license → PIN → test print → cash sale.

---

### Reference — real symbols named above
- Edition: `src/lib/edition.ts` (`EDITION`, `isLocal`, `LOCAL_BUSINESS_ID="local"`, `LOCAL_USER_ID`).
- Seam: `src/lib/data-store/{index.ts:getDataStore, local.ts:createLocalDataStore, sqlite/tauri-driver.ts:createTauriSqlDriver}`.
- Printer: `src/features/peripherals/transports/tauri.ts:createTauriPrinter`; `auto-print.ts:{printOrderById,buildOrderReceiptBytes}`; `components/DevicesManager.tsx`.
- License TS: `src/lib/license/{license.ts:packLicense/unpackLicense/signLicense/verifyLicense, gate.ts:resolveLicenseState/isLicensed, store.ts:createLicenseStore, issue.ts:issueLicense/buildLicenseClaims, webcrypto.ts:webcryptoEd25519Verifier/Signer/importEd25519PrivateKey}`.
- License Rust: `src-tauri/src/license.rs:{PUBLIC_KEY(line 20 placeholder),verify_license}`; `lib.rs:{print_raw,open_drawer,check_license,invoke_handler}`.
- Build/config: `next.config.ts` (`localConfig` `output:'export'`), `package.json` (`build:local`), `src-tauri/tauri.conf.json`, `.github/workflows/desktop-release.yml`.
