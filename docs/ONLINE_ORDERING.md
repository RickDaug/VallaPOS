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
| **IP rate limit** | `rateLimit()` (`src/lib/rate-limit.ts`) — shared Upstash fixed-window limiter (same optional-Redis pattern as `pin-throttle.ts`), keyed `online-submit:<businessId>:<ip>`. Default **8 requests / 60s / IP**. Fails **open** on a limiter outage so it can't take the endpoint down. |
| **Input caps (zod)** | `submitOnlineOrderSchema`: ≤100 lines, qty ≤99, ≤30 modifiers/line, name ≤80, phone ≤40, tip bounded. No client price, no discount, no ad-hoc modifier, no price snapshot. |
| **Server-authoritative pricing** | Every unit price / modifier delta / tax / total is **recomputed from the DB** via `resolveOrderLines` + `computePricedOrder` — the exact engine the register checkout uses. Unknown / foreign / cross-tenant item or modifier ids, or an unsatisfied required group, are rejected as a generic `invalid` (leaks nothing). The customer sends **no money amount**. |
| **Tenant scope** | The order + all lookups are scoped to `businessId` (guarded by the tenant-isolation CI check). |
| **Idempotent** | Keyed on `clientUuid` (`@@unique([businessId, clientUuid])`), including the concurrent **P2002** insert race — a double-tap never places two orders. |
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

## Merchant board & live updates

- `listOnlineOrders(businessId)` returns SUBMITTED/ACCEPTED/READY orders (oldest
  first) with items + customer name/phone. `countIncomingOnlineOrders` powers the
  nav badge + poller.
- Transitions are `take_orders`-gated (the capability cashiers use to take sales),
  tenant-scoped, zod-validated.
- Live: `OnlineOrderAlerts` (mounted in the business layout when enabled + the
  operator can take orders) polls `/[businessId]/online/count` every 15s **while
  the tab is visible** (poll-on-visible, mirroring `FloorService`), fires a
  `useToast` when the SUBMITTED count rises, and `router.refresh()`es to update the
  server-rendered nav badge + the board.

## Settlement / payment (v1)

- **Complete** leaves the order `status=OPEN` (an unpaid sale). v1 payment is
  pay-on-pickup or the confirm-based QR handle shown on the customer's
  confirmation — the merchant collects out-of-band. A COMPLETED online order that
  was paid ahead can simply be left; it contributes nothing to cash/Z-report
  totals (no `Payment` rows) until a real settlement path records payment.
- **Reject** sets `status=VOIDED` so it never counts as a sale.

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
