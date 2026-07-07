# VallaPOS — Integrated Payments (Phase 3 groundwork)

> **Status: DESIGN + INERT SCAFFOLD only.** No live payment integration, no
> Stripe SDK, no schema change applied. This document is the foundation a human
> approves before any real money rail is wired. The code under
> `src/features/payments/` is a parallel structure (default-OFF feature flag);
> the live checkout in `src/features/register/actions.ts` is **unchanged**.

Pairs with [`PRD.md`](./PRD.md) (FACTA/PCI/scope), [`ARCHITECTURE.md`](./ARCHITECTURE.md)
(server-authoritative money, route handlers for webhooks) and [`ROADMAP.md`](./ROADMAP.md)
(payments are the Phase 2→3 monetization milestone).

---

## 1. Framing & decisions on record

From `STATE.md` → "Decisions on record":

- **Payments were deferred for v1** — cash / manual only.
- **Browser-POS reality:** Tap-to-Pay and Bluetooth readers are **native-only**.
  The browser PWA physically cannot do card-present. Card-present is sequenced to
  a later **native shell** (React Native / Capacitor).
- **Lead with what the browser does well:** cash (shipped) + **QR / payment links**,
  then **Stripe Terminal** card-present once a native shell exists.

This groundwork keeps that framing: cash is the reference implementation; QR /
manual is the next browser-friendly rail; Stripe Terminal/Tap-to-Pay is gated
behind the native shell and a capability flag (`requiresNativeShell`).

---

## 2. The `PaymentProvider` abstraction

A **provider** is the uniform surface the register and restaurant-tab flows will
call instead of hard-coding cash writes. One concrete provider per rail; a pure
registry/selector picks one by `PaymentMethod` + runtime.

### Interface (`src/features/payments/provider.ts`)

```ts
interface PaymentProvider {
  readonly id: string;                       // "cash" | "manual" | "stripe-terminal"
  readonly method: PaymentMethod;            // Prisma enum: CASH | CARD | QR | MANUAL
  readonly capabilities: ProviderCapabilities;

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  capture(intentId: string): Promise<PaymentIntent>;
  cancel(intentId: string): Promise<PaymentIntent>;
  status(intentId: string): Promise<PaymentIntent>;
  refund(intentId: string, amountCents: number): Promise<RefundResult>;
}
```

### Capability flags (`ProviderCapabilities`)

| Flag | Meaning | cash | manual/QR | Stripe Terminal |
|---|---|:---:|:---:|:---:|
| `supportsCardNotPresent` | hosted link / keyed card | ✗ | ✓ (QR/link) | ✗ |
| `supportsCardPresent` | physical reader tap/chip | ✗ | ✗ | ✓ |
| `supportsQr` | QR / payment-link rail | ✗ | ✓ | ✗ |
| `supportsRefund` | programmatic refund | ✓ (local) | ✓ | ✓ |
| `supportsPartialCapture` | partial amounts | ✓ | ✓ | ✓ |
| `requiresNativeShell` | **needs native app** (Bluetooth/Tap-to-Pay) | ✗ | ✗ | ✓ |

`requiresNativeShell` is the **load-bearing** flag: the registry filters it out on
the `web` runtime, so a card-present reader can never be offered in the browser
PWA. This encodes the "browser can't do Tap-to-Pay" reality in one place.

### Lifecycle (`PaymentIntentStatus`)

```
requires_action → processing → captured
                            ↘ failed
       (any) → canceled
```

- **Cash** is synthetic: `createIntent` returns `captured` immediately (customer
  hands over money; no processor round-trip), with `changeCents = tendered - total`.
- **QR / Terminal** start at `requires_action` (scan QR / tap reader), advance
  via `status()` polling and/or a **webhook** (see §5), then `captured`.

`PaymentIntent.nextAction` tells the UI what to surface: `display_qr`,
`redirect`, `use_reader`, `collect_cash`, or `none`.

---

## 3. Mapping each rail onto the abstraction

### Cash (shipped — described, not changed)

`src/features/payments/providers/cash.ts` is the **reference** provider. It does
not replace the live path; it describes it. When the register migrates onto
providers, this must keep producing exactly the row the live transaction writes
today: `Payment{ method: CASH, status: CAPTURED, amountCents = total,
tenderedCents, changeCents }`. The underpayment guard mirrors the live
`"Cash tendered is less than the total."` check.

### Manual / QR (next — browser-friendly, lowest PCI scope)

Two flavors:

- **Manual:** the operator collects payment out-of-band (Venmo/Zelle/cash-app
  screenshot, external terminal) and records it. `Payment.method = MANUAL`,
  `status = CAPTURED`, no processor ref. Zero PCI scope. Mirrors how cash is
  recorded; just a different labeled tender.
- **QR / payment link:** a hosted **Stripe Payment Link** (or a regional QR rail —
  see open decisions) renders a QR. The PAN never touches our servers (**SAQ A**).
  `createIntent` → `requires_action` + `nextAction.display_qr`; a **webhook**
  confirms capture and flips the `Payment` to `CAPTURED`. `method = QR`.

### Stripe Terminal (later — card-present, native shell required)

A smart reader (or **Tap to Pay** on the device) handled by the native shell. The
PAN goes reader → Stripe directly; our code only ever sees brand + last4 (FACTA).
`requiresNativeShell = true` ⇒ unavailable on web. `method = CARD`, `processorRef`
= Stripe PaymentIntent id, plus `cardBrand` / `cardLast4`.

---

## 4. Checkout integration points (where a provider slots in)

The live `checkout()` in `src/features/register/actions.ts` is the contract to
preserve. Its load-bearing properties **must not change** when providers land:

1. **Server recomputes all totals** from DB prices + business tax (never trusts
   client amounts) — via `resolveOrderLines` + `computePricedOrder`.
2. **Idempotent on `clientUuid`** (`@@unique([businessId, clientUuid])`, with the
   P2002 re-read on the concurrent race).
3. **One `$transaction`** writes Order + OrderLine(+modifiers) + Payment, and
   atomically allocates the per-business order number via `OrderCounter`.

A provider-aware checkout (behind the flag) changes only the **Payment leg**:

```
checkout(input):
  requireCapability(take_orders)            # unchanged
  idempotency pre-check on clientUuid       # unchanged
  resolveOrderLines + computePricedOrder    # unchanged — SERVER-AUTHORITATIVE total
  provider = selectProvider(input.method, runtime)   # NEW (flag-gated)
  intent = provider.createIntent({ amountCents = total, clientUuid, ... })  # NEW
  if intent.status == 'captured':           # cash/manual: synchronous
    $transaction { Order + lines + Payment(from intent) }   # same shape as today
  else:                                      # QR/Terminal: async
    $transaction { Order(OPEN) + lines + Payment(PENDING, processorRef) }
    → return nextAction (QR/redirect/reader); webhook later flips to CAPTURED
```

- **Cash stays fully synchronous and offline-capable** — no behavior change; the
  cash provider just wraps the existing math.
- **Async rails (QR/Terminal)** create an `OPEN` order with a `PENDING` payment,
  return a `nextAction`, and settle on the **webhook** (§5). The `clientUuid`
  idempotency key is reused as the processor idempotency key end-to-end.
- **Offline:** only cash/manual are offline-capable (no processor reachable). The
  registry's runtime filter + a future `supportsOffline` gate keep card/QR out of
  the offline queue (they'd fail to reach the processor anyway).
- **Refunds/voids:** the existing `refundOrder`/`voidOrder` (reversing negative
  `Payment` rows) become `provider.refund()` for card/QR; cash/manual keep the
  local reversing-row behavior.

---

## 5. Proposed Prisma schema additions (NOT APPLIED)

> ⚠ **Proposal only.** `prisma/schema.prisma` is untouched. This is the concrete
> migration to apply on a later, decision-gated PR — on its **own branch**, applied
> to Neon **before merge** (per the STATE migration rule). Everything is additive,
> nullable/defaulted, so existing cash orders are untouched.

### 5.1 Fields on `Payment`

```prisma
model Payment {
  // ... existing fields ...
  providerId    String?   // which PaymentProvider settled this (e.g. "stripe-terminal")
  intentId      String?   // provider-local intent id (cash: synthetic "cash_<uuid>")
  // processorRef already exists (Stripe PaymentIntent id) — reused, not duplicated.
  capturedAt    DateTime? // when funds actually captured (async rails differ from createdAt)
  failureCode   String?   // processor decline/error code for surfacing + reporting

  @@index([businessId, intentId])
}
```

Rationale: `providerId` + `intentId` let a webhook find the row to flip from
`PENDING`→`CAPTURED`/`FAILED` and make capture idempotent. `processorRef` already
exists — keep using it. `cardBrand`/`cardLast4` already exist (FACTA-safe).

### 5.2 New `PaymentIntent` record (async-rail audit trail)

A transaction/intent log decoupled from the `Payment` row, so an intent that
never captures (abandoned QR, declined tap) is still recorded and reconcilable.

```prisma
enum PaymentIntentState {
  REQUIRES_ACTION
  PROCESSING
  CAPTURED
  CANCELED
  FAILED
}

model PaymentIntent {
  id           String             @id @default(cuid())
  businessId   String
  orderId      String?            // the order it settles (may be OPEN first)
  clientUuid   String             // reuse the offline idempotency key end-to-end
  providerId   String             // "stripe-terminal" | "manual" | "cash" ...
  method       PaymentMethod
  state        PaymentIntentState @default(REQUIRES_ACTION)
  amountCents  Int
  currency     String             @default("USD")
  processorRef String?            // Stripe PaymentIntent id
  failureCode  String?
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  business     Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, clientUuid]) // idempotent like Order — one intent per attempt
  @@index([businessId])
  @@index([businessId, processorRef])
}
```

Rationale: the existing `Payment` row is the *settled* record; this captures the
*attempt* lifecycle for async rails (and a clean idempotency anchor for webhooks).
Cash can skip it (synchronous) or write one for a uniform audit trail — a decision.

### 5.3 Refund linkage

Today refunds are reversing negative `Payment` rows (no parent link). For
processor refunds we want an explicit link + processor refund id:

```prisma
model Payment {
  // ...
  refundedPaymentId String?    // the original capture this row reverses (null for captures)
  refundOf          Payment?   @relation("PaymentRefunds", fields: [refundedPaymentId], references: [id])
  refunds           Payment[]  @relation("PaymentRefunds")
  refundRef         String?    // processor refund id (Stripe refund_...), null for cash
}
```

Rationale: makes partial-refund accounting explicit (sum children vs parent) and
gives a processor handle. The current reconciliation (Σ payment movements,
refunds as negatives) still holds; this just adds linkage.

### 5.4 Provider config (per business)

Stripe Connect / Terminal credentials are per-merchant. Proposed (secrets live in
env/secret store, NOT the DB — only non-secret references here):

```prisma
model PaymentProviderConfig {
  id                  String   @id @default(cuid())
  businessId          String
  providerId          String   // "stripe-terminal" | "stripe-link" | "manual"
  enabled             Boolean  @default(false)
  stripeAccountId     String?  // Connect account id (acct_...) — not a secret
  // NO API keys here — platform secret + per-account tokens live in the secret store.
  createdAt           DateTime @default(now())
  business            Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, providerId])
  @@index([businessId])
}
```

---

## 6. Open decisions (need a human before a real integration)

> **⚠ RESOLVED 2026-07-07 — see [§9 Decision-locked direction](#9-decision-locked-direction-2026-07-07).** The
> load-bearing decisions (#1 market, #2 single-vs-multi-merchant, #3 fee model, #5
> manual tender) are decided; §9 records the resolutions + the sequenced build plan.
> This section is kept for the original framing/rationale.

These gate the first real-integration PR. Listed for explicit sign-off:

1. **QR rail.** Stripe **Payment Links** (US-first, SAQ A, one vendor) vs a
   regional QR rail (e.g. SPEI/CoDi, PIX, UPI) — VallaPOS targets mobile/local
   businesses and the project memory mentions LATAM-flavored merchants. Which
   market(s) first? This decides the whole QR provider.
2. **Stripe Terminal vs Stripe Connect (vs both).** Terminal = card-present
   readers for *our own* account. Connect (Standard) = multi-merchant SaaS where
   each business is its own Stripe account and we're the platform. Roadmap lists
   both (Phase 2 Terminal, Phase 3 Connect). Are we a **single-merchant** tool or
   a **multi-merchant platform** at launch? (Connect changes onboarding, payouts,
   fees, and `PaymentProviderConfig` above.)
3. **Fee model / monetization.** This is the monetization milestone. Flat
   subscription? Per-transaction markup (application fee via Connect)? Interchange-
   plus passthrough? This determines whether we *need* Connect and how fees are
   recorded (a `feeCents` column on `Payment`?).
4. **Native shell choice & timing.** React Native vs Capacitor for the Tap-to-Pay
   / Bluetooth-reader shell. Card-present is blocked until this exists; everything
   `requiresNativeShell` waits on it.
5. **Manual tender scope for v1.** Ship a generic "Manual / Other" tender
   (Venmo/Zelle/external terminal, recorded like cash, zero PCI) as the immediate
   next step before any processor wiring? Cheapest win, fully browser-friendly.
6. **PaymentIntent record for cash.** Write a `PaymentIntent` row for synchronous
   cash too (uniform audit trail) or only for async rails (less write overhead)?
7. **Offline policy for cards.** Confirm card/QR are **never** queued offline
   (they can't reach the processor); only cash/manual stay offline-capable. The
   roadmap mentions "offline card queueing (store-and-forward)" for v1 — is that
   in or deferred? It carries real chargeback/decline risk.
8. **Webhook endpoint + secret.** A `app/api/payments/webhook/route.ts` (route
   handler, per ARCHITECTURE) with signature verification. Needs the Stripe
   webhook secret in env and a decision on idempotent replay handling.

---

## 7. Sequencing / rollout

All behind the `PAYMENTS_V2_ENABLED` flag (default OFF, `src/features/payments/flags.ts`):

1. **Groundwork (this PR):** abstraction + cash reference provider + registry +
   tests + this doc. No behavior change, no schema, no deps.
2. **Manual tender (browser, no processor):** register the `manual` provider; add
   a "Manual / Other" tender button (decision #5). Smallest real step.
3. **Schema migration (own branch):** apply §5 additions to Neon **before merge**.
4. **QR / payment link (browser, SAQ A):** register the `qr` provider + the
   webhook route handler; async `OPEN`→`CAPTURED` flow; pin the Stripe SDK exactly
   + commit the lockfile (decision-gated, its own PR).
5. **Native shell + Stripe Terminal / Tap to Pay:** only after the shell exists;
   `requiresNativeShell` providers register and become available on `native`.
6. **Connect + fees (if multi-merchant):** onboarding, `PaymentProviderConfig`,
   application fees (decisions #2, #3).

Each step ships independently, flag-gated, with the cash path untouched until the
register is deliberately migrated onto the provider abstraction.

---

## 8. What the scaffold contains (this PR)

`src/features/payments/`:

- `types.ts` — pure types (capabilities, intent, amount, next-action, refund).
- `provider.ts` — the `PaymentProvider` interface.
- `providers/cash.ts` — cash reference provider (describes the live behavior).
- `registry.ts` — pure registry + selector + runtime capability filtering.
- `flags.ts` — `PAYMENTS_V2_ENABLED` (default OFF) gate.
- `index.ts` — barrel.
- `registry.test.ts`, `flags.test.ts` — unit tests for selection + flags.

**Inert:** nothing here is imported by the live checkout, register UI, or any
route. `npm run build` includes it as dead-but-valid code; the money path in
`src/features/register/actions.ts` is byte-for-byte unchanged.

---

## 9. Decision-locked direction (2026-07-07)

The §6 open decisions are resolved. Scoped against the current Stripe API
(`2026-06-24.dahlia`), Connect **Accounts v2**, and the Stripe SaaS-platform pattern.

| §6 # | Decision | Resolution |
|---|---|---|
| 2 | Single vs multi-merchant | **Multi-merchant — Stripe Connect.** One connected account per `Business`. |
| 3 | Fee model | **Flat SaaS subscription. NO per-transaction application fee** (we take no cut of sales). |
| 1 | QR rail / market | **Country-agnostic hosted Checkout** across **US + MX + BR**; local methods surface per connected account. |
| 5 | Manual tender v1 | ✅ Shipped (#62). |
| 4 | Native shell | **Deferred** — Terminal / Tap-to-Pay wait on the future native shell (Phase 3). |
| 7 | Offline cards | **Never queued offline** — only cash/manual stay offline-capable. |

### Charge pattern: **SaaS / DIRECT charges**

Each business runs its own business, owns its customers, and keeps its own money →
Stripe's SaaS mapping. The **connected account is the merchant of record**; VallaPOS
is just software. Because we take **no cut**, we simply **omit `application_fee_amount`** —
a pure pass-through. This is the lowest-liability / lowest-PCI posture for the platform
(disputes, refunds, payouts, and negative-balance risk all sit with the merchant's Stripe
account).

### Connect account configuration (Accounts v2)

Create with `POST /v2/core/accounts` — **never** the legacy `type: 'standard'|'express'|'custom'`.

- `dashboard: "full"` — businesses get the real Stripe Dashboard (they run independent businesses)
- `defaults.responsibilities.fees_collector: "stripe"` — the connected account pays Stripe's processing fees
- `defaults.responsibilities.losses_collector: "stripe"` — Stripe owns negative-balance liability
- `configuration.merchant` requesting `card_payments` (add `oxxo`/`customer_balance` SPEI for MX, `pix` for BR later)
- **Country set per business at creation** (US | MX | BR) → **needs a `country` field on `Business`** (today only `currency`)
- Onboarding: the embedded **`account_onboarding`** component + the **required `notification_banner`**
- **Go-live gate:** offer the rail only when
  `configuration.merchant.capabilities.card_payments.status === 'active'` — NOT the deprecated `charges_enabled`.

### QR sale rail: Checkout Session on the connected account (direct charge)

- `stripe.checkout.sessions.create({ mode: 'payment', ... }, { stripeAccount: business.stripeAccountId })`
- **Omit `payment_method_types` entirely** → dynamic payment methods. This is what makes it
  country-agnostic: each connected account shows its own eligible methods (cards everywhere;
  OXXO/SPEI in MX, PIX in BR as enabled).
- Amount = the **server-recomputed** order total (cents, per §4); `client_reference_id = clientUuid`
  (reuse the offline idempotency key end-to-end).
- Render the returned `session.url` as a **QR** (the ESC/POS formatter already has a `GS ( k` QR
  primitive) — the customer scans on their phone and pays on Stripe's hosted page.
- Order is created `OPEN` with a `PENDING` Payment; it settles on the **webhook**, never on the
  synchronous response.

### Webhooks (two independent, signature-verified streams)

1. **Connected-account events (sales)** — `checkout.session.completed` /
   `checkout.session.async_payment_succeeded` → flip Order `OPEN→PAID`, Payment `PENDING→CAPTURED`
   (idempotent on session id / `client_reference_id`); `checkout.session.expired` /
   `async_payment_failed` → mark failed. Route: `app/api/payments/webhook/route.ts`.
2. **Platform events (our subscription)** — `invoice.paid`, `customer.subscription.updated|deleted`
   → set the business's subscription status. Distinguished by the presence of `event.account`.

### Flat subscription (our revenue) — decoupled from the sale rail

- Stripe **Billing** on **our platform account**. The business owner is a normal **Customer of
  VallaPOS**, unrelated to their own Connect account — two separate Stripe relationships (they pay
  *us* for the software; their customers pay *them* for goods).
- Onboard via Checkout Session `mode: 'subscription'` (one flat-plan `Price`; omit
  `payment_method_types`); self-service via the **Customer Portal**.
- Gate app access on `subscriptionStatus` (`active`/`trialing` = allowed).

### Schema deltas (refines §5 — one migration, own branch, apply to Neon **before** merge)

- `Business.country String @default("US")` — (US|MX|BR) required for Accounts v2 + local methods
- `Business.stripeAccountId String?` + `stripeChargesEnabled Boolean @default(false)` (mirror capability status)
- `Business.stripeCustomerId String?`, `subscriptionStatus String?`, `subscriptionPriceId String?` — the SaaS subscription
- `Payment`: `providerId`, `processorRef` (reuse — Checkout Session/PI id), `capturedAt`, `failureCode` (§5.1)
- `PaymentIntent` audit record (§5.2) for the async QR lifecycle
- **Drop §5.4 `PaymentProviderConfig`** — one account per business now lives on `Business`; re-add only if a business ever needs multiple providers.

### Sequenced PRs (all behind `PAYMENTS_V2_ENABLED`; cash/manual path untouched)

- **PR-A — Connect onboarding (no sale rail yet).** Accounts v2 create + embedded onboarding +
  capability webhook + `Business.country/stripeAccountId`. A business can connect its Stripe account;
  nothing charges yet. Pin the `stripe` SDK exactly + commit the lockfile. Restricted API key (`rk_`).
- **PR-B — schema migration** (own branch, Neon before merge) for the Payment/PaymentIntent deltas.
- **PR-C — QR sale rail.** `qr` provider (Checkout Session on the connected account) +
  `app/api/payments/webhook` + a register "Pay by QR" tender → `OPEN`/`PENDING` → webhook `CAPTURED`.
  US-first test, then enable MX/BR methods.
- **PR-D — SaaS subscription.** Platform Billing + Checkout subscription + Customer Portal +
  subscription webhook + gate app access on status.
- **(Later) Native shell → Stripe Terminal / Tap to Pay** (`requiresNativeShell`).

### New env / secrets (platform account; restricted keys)

`STRIPE_SECRET_KEY` (restricted `rk_`), `STRIPE_WEBHOOK_SECRET` (sales/Connect endpoint),
`STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (platform endpoint, if split), `STRIPE_SUBSCRIPTION_PRICE_ID`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Add to `env.ts` as **optional** (degrade to flag-OFF when
unset — mirrors the Upstash lesson) so a missing key never breaks the build.
