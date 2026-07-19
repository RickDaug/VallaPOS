# Online ordering — QR self-ordering & pay (v1)

A customer scans a QR at the truck / table / stall, orders from their phone (no
app, no login), and the order lands on the merchant's **Online** screen where
staff accept + fulfill it. Payment in v1 is **pay-on-pickup** or the merchant's
existing **confirm-based QR-pay handle** (PIX / UPI / Venmo / PayPal.me / link) —
no PSP, no card data. Real online **card** checkout (Stripe Connect Checkout) is a
documented extension point (see [Extension seam](#extension-seam), `docs/PAYMENTS.md`
PR-C), not built here.

The whole feature is **inert by default**: `Business.onlineOrderingEnabled` is
`false`, so the public page 404s and nothing changes for existing businesses until
a merchant turns it on in **Settings → Online ordering**.

## Flow

1. **Merchant** enables online ordering in Settings, optionally sets pickup
   instructions, and prints/shares the generated QR / link (`…/order/<businessId>`).
2. **Customer** scans → the public menu (`app/order/[businessId]/page.tsx`) →
   browse, pick items + modifiers, optional name + phone → **Place order**.
3. On success the customer sees an **order number**, total, pickup instructions,
   and the merchant's **pay-from-your-phone QR** (if configured) or "pay at pickup".
4. The order lands **SUBMITTED** on the merchant's **Online** board
   (`app/(app)/[businessId]/online/page.tsx`). A nav badge + a `useToast`
   announce new orders live (poll-on-visible, like the floor view).
5. Staff **Accept** (→ ACCEPTED, **stock decrements here**) → **Ready** (→ READY)
   → **Complete** (→ COMPLETED) or **Reject** (→ REJECTED, restocked if it had
   been accepted).
6. Staff **Take payment** on the board (Cash / QR / Other) → records a `Payment`
   and flips the order to **PAID**, so it becomes realized revenue/tax on the
   Z-report. Independent of the fulfilment status above (pay before or after
   Complete); a completed-but-unpaid order stays on the board until it's settled.

### Status lifecycle

```
SUBMITTED ──accept──▶ ACCEPTED ──ready──▶ READY ──complete──▶ COMPLETED
     │                   │                  │
     └──reject──▶ REJECTED (from SUBMITTED / ACCEPTED / READY)
```

Pure machine in `src/features/online/status.ts` (unit-tested). `ACCEPTED` may skip
straight to `COMPLETED`.

## The public endpoint's security model

`submitOnlineOrder` (`src/features/online/actions.ts`) is **public and
unauthenticated** — anyone with the link can call it. Every control is enforced
server-side; the client is never trusted for anything that matters:

| Control | How |
| --- | --- |
| **Enable-gate** | Rejected (`unavailable`) unless `Business.onlineOrderingEnabled`. A missing/disabled business is indistinguishable → the page also 404s via `getPublicMenu`. |
| **IP rate limit** | `rateLimit()` (`src/lib/rate-limit.ts`) — shared Upstash fixed-window limiter (same optional-Redis pattern as `pin-throttle.ts`), keyed `online-submit:<businessId>:<ip>`. Default **20 requests / 60s / IP** (raised from 8 so a busy shared-NAT venue isn't throttled). The client IP is taken from a **platform-trusted** source — `x-vercel-forwarded-for`, else the **right-most** hop of `x-forwarded-for` — never the client-spoofable left-most entry (A5). This path **fails CLOSED** (`onError: "memory"`): on a Redis outage it falls back to a strict per-instance in-memory counter rather than removing all throttling. |
| **Input caps (zod)** | `submitOnlineOrderSchema`: ≤100 lines, qty ≤99, ≤30 modifiers/line, name ≤80, phone ≤40, **tip hard-capped at $1,000** (`MAX_TIP_CENTS` — the tip is the one client-authoritative amount, so a seven-figure "tip" can't be bolted onto the recomputed subtotal; #13). No client price, no discount, no ad-hoc modifier, no price snapshot. |
| **Server-authoritative pricing** | Every unit price / modifier delta / tax / total is **recomputed from the DB** via `resolveOrderLines` + `computePricedOrder` — the exact engine the register checkout uses. Unknown / foreign / cross-tenant item or modifier ids, or an unsatisfied required group, are rejected as a generic `invalid` (leaks nothing). The customer sends **no money amount**. |
| **Tenant scope** | The order + all lookups are scoped to `businessId` (guarded by the tenant-isolation CI check). |
| **Idempotent (channel-scoped)** | Keyed on `clientUuid` (`@@unique([businessId, clientUuid])`), including the concurrent **P2002** insert race — a double-tap never places two orders. The idempotency read is scoped to `channel: "ONLINE"` (#16) so a reused UUID can never read back an in-person order's number/total to an anonymous caller. |
| **Minimal response** | Returns only `{ orderId, number, totalCents }` — no cross-customer data. |

The created order is `status=OPEN` (unpaid), `channel=ONLINE`,
`onlineStatus=SUBMITTED`, `cashierId=null`.

## Stock: decrement on ACCEPT, not on submit (deliberate)

Inventory is **not** decremented when the customer submits — it moves when **staff
accept** the order (`transitionOnlineOrder` accept path). Rationale: a public,
anonymous endpoint invites spam / abandoned orders; decrementing on submit would
let anyone drain a merchant's on-hand counts without a real sale. Accepting is a
staff decision, so that's where stock commits. A **reject** restocks **only** if
the order had already been accepted (`isStockCommittedAt`) — a reject straight from
SUBMITTED never decremented, so it never restocks. Oversell is allowed (counts may
go negative), matching the register checkout.

**Atomic transition (no double-decrement — A4).** `transitionOnlineOrder` does the
status change as a **guarded compare-and-set** inside the transaction —
`updateMany({ where: { …, onlineStatus: current }, data: { onlineStatus: target } })`
— and runs `adjustStock` **only when that update actually applied** (`count === 1`).
Two staff (or a double-tap) both Accepting the same SUBMITTED order therefore
decrement stock **exactly once**: the loser's guarded update matches zero rows and
is returned as `{ status: "already" }` (a friendly no-op), never re-running the
decrement. The action returns `{ status: "applied" | "already" }`.

## Merchant board & live updates

- `listOnlineOrders(businessId)` returns SUBMITTED/ACCEPTED/READY orders (oldest
  first) with items + customer name/phone. `countIncomingOnlineOrders` powers the
  nav badge + poller.
- Transitions are `take_orders`-gated (the capability cashiers use to take sales),
  tenant-scoped, zod-validated.
- Live: `OnlineOrderAlerts` (mounted in the business layout when enabled + the
  operator can take orders) polls `/[businessId]/online/count` every 15s **while
  the tab is visible** (poll-on-visible, mirroring `FloorService`). When the
  SUBMITTED count rises it (#6): plays a short **audio chime** (Web Audio, no
  asset — so staff notice away from the screen) and bumps a **persistent
  unacknowledged counter** rendered as a fixed `aria-live="assertive"` banner
  (with a link to the board + a dismiss button) that **stays until acted on** —
  not an auto-dismissing toast. It also `router.refresh()`es to update the
  server-rendered nav badge + the board. The chime is a best-effort enhancement
  (autoplay policies may block it until a gesture); the visual banner is always
  the reliable signal.

## Settlement / payment (v1)

The fulfilment lifecycle (Accept/Ready/Complete) and **settlement** are separate
dimensions. Completing an order does **not** by itself record money — settlement is
the explicit **Take payment** step.

- **Take payment** → `settleOnlineOrder({ businessId, orderId, method, tipCents? })`
  (`src/features/online/actions.ts`). `take_orders`-gated, tenant-scoped, zod. In
  ONE transaction it writes a `Payment` at the order's **server-stored total**
  (method ∈ `CASH | QR | MANUAL`, recorded exactly like the register's
  non-cash/manual tenders — `amountCents = total`, no tendered/change) and flips
  `Order.status → PAID`, **without touching stock** (stock already moved on
  Accept). An optional staff `tipCents` (same hard cap as the public tip) is added
  on top. The flip is a **guarded** `updateMany({ where: { status: "OPEN" }, … })`
  so a double-tap / two-staff race writes exactly **one** payment (the loser
  returns `already_paid`). Once PAID the order is a normal sale: it flows into the
  existing **Z-report / tax / item reports**, which filter `status = "PAID"`.
- **Why this exists (A1).** Before it, a completed online order was stranded
  `OPEN` forever with no `PAID` writer reachable for it (the register creates a
  *new* sale; `settleTab` is restaurant-floor-only), so a food truck could never
  turn a QR order into revenue/tax. `settleOnlineOrder` is that missing writer.
- **On the board.** Each card shows a **Paid / Unpaid** chip and, while unpaid, a
  **Take payment** control (tender picker). A COMPLETED-but-unpaid order stays on
  the board (see `listOnlineOrders`) so it can still be settled; a PAID or VOIDED
  order drops off.
- **Reject** sets `status=VOIDED` so it never counts as a sale (and cannot be
  settled).

## Extension seam

Real online **card** payment (Stripe Connect hosted Checkout — `docs/PAYMENTS.md`
PR-C) slots in cleanly without reworking this feature:

- Add an optional `createCheckoutSession(order)` step after `submitOnlineOrder`
  builds the order (or a `paid` gate before ACCEPT), driven by the existing
  `PAYMENTS_V2_ENABLED` flag + the business's connected account.
- On a `checkout.session.completed` webhook, write a `Payment` (method `CARD`) and
  flip the order to `PAID` — the same money-recording path the register uses.
- The order lifecycle, board, stock-on-accept, and idempotency are unchanged; only
  the tender/settlement step is added. Nothing here assumes cash-only.

## Files

- Schema: `prisma/schema.prisma` — `OrderChannel`, `OnlineOrderStatus` enums;
  `Order.channel/onlineStatus/customerPhone`; `Business.onlineOrderingEnabled/onlineOrderInstructions`.
  Migration `prisma/migrations/20260716000000_online_ordering` (additive; **create-only, not yet applied to Neon**).
- Public: `app/order/[businessId]/page.tsx`, `src/features/online/components/PublicOrder.tsx`.
- Merchant: `app/(app)/[businessId]/online/{page,count/route}.tsx`,
  `src/features/online/components/{OnlineOrdersBoard,OnlineOrderAlerts}.tsx`.
- Server: `src/features/online/{queries,actions,schema,status}.ts`,
  `src/lib/rate-limit.ts`.
- Settings: `src/features/online/components/OnlineOrderingSettings.tsx`.
