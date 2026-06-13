# VallaPOS — Product Requirements

## 1. Vision

A dead-simple, browser-based point of sale that mobile and local operators can open and start selling with — no hardware contract, no enterprise complexity. Win on the things big POS systems are bad at for this audience: **truly optional inventory, first-class services, a fast touch UI, and working offline.**

## 2. Target users (personas)

| Persona | Needs |
|---|---|
| **Food truck owner** | Fast tap-to-add menu, modifiers (no onions, extra cheese), tips, cash + card, works when the lot has no signal |
| **Barber / salon** | Services as line items (no stock), walk-ins *and* appointments, tip prompts, per-employee sales |
| **Lawn care / mobile service** | Ring up a service on-site, email receipt, no inventory, simple daily totals |
| **Small vendor / pop-up** | One-tap checkout on a phone, cash drawer reconciliation, end-of-day report |

Common thread: **one or a few people, a phone or tablet, intermittent connectivity, services and/or simple goods.**

## 3. Core principles

1. **Inventory is optional** — globally and per-item. Service businesses never see stock.
2. **Services are first-class** — a haircut or mow is a sellable line item with no stock semantics.
3. **Offline-first** — catalog, cart, cash, and receipts work with no network; sync on reconnect.
4. **Touch-first** — ≥44×44px targets, whole rows tappable, primary actions in the thumb zone.
5. **Honest money** — integer cents end to end; tax shown separately; FACTA-compliant receipts.
6. **Multi-tenant & safe** — every business's data is isolated; roles limit what cashiers can do.

## 4. Data model (conceptual)

Following the industry-standard catalog shape (Square/Clover/Loyverse):

```
Category → Item → Variation → ModifierGroup → Modifier
```

- **Price and SKU live on the Variation**, not the Item ("Latte" is the item; Small/Medium/Large are variations).
- **Modifiers are part of the taxable, discountable base** (item price + selected modifiers).
- **Variants** = fixed forms (size/color, own price+SKU). **Modifiers** = sale-time customizations.
- Items have a **type** (product vs service); service items skip stock entirely.

See [`prisma/schema.prisma`](../prisma/schema.prisma) for the concrete model.

## 5. Functional scope

### MVP — "ring up a sale, get paid, see today's total"
- Catalog: Category → Item → Variation → Modifier
- Inventory **off by default**; product *and* service line items
- Touch cart: add / qty / remove, line + cart discounts (% and fixed), tips (15/20/25 + custom/none)
- Tax: single **configurable** rate, exclusive (added at tender), shown separately; tax computed per line **after** discount (policy documented & consistent)
- Payments: **cash** (tender, change due, drawer totals) + **Stripe Payment Link / QR** (zero hardware, lowest PCI scope)
- Receipts: on-screen + email, **card number truncated, no expiry** (FACTA)
- End-of-day **Z-report**: net sales, tax collected, payment-method split, cash expected-vs-counted + over/short
- Auth: real accounts, single business per owner to start
- PWA: catalog + cart + cash work offline, explicit sync-on-reconnect

### v1 — "a real business tool"
- Roles & permissions (Owner / Manager / Cashier) + manager-PIN override; employee PINs + clock in/out
- Refunds (full/partial, scoped) and voids (distinct, capture-keyed) with reasons
- Split payments (by amount / even / by item)
- Reports: sales by item, by category, by employee; tips by employee; daily auto-summary
- Appointments for service businesses: calendar + SMS/email reminders + deposits
- Stripe Terminal smart reader (card-present, card never touches our code)
- Offline card queueing (store-and-forward with cap + sync deadline + "unsynced" badge)
- Networked receipt printer (WebPRNT/HTTP); SMS receipts
- Optional per-item inventory tracking

### v2 — "depth & differentiation"
- Native/React Native shell for **Tap to Pay** (no-hardware card acceptance)
- Stripe Connect (Standard accounts) for multi-merchant SaaS
- Open/bar tabs with card pre-authorization
- Kitchen Display System (Sent → Fired → Fulfilled)
- Multi-rate tax + Stripe Tax/TaxJar; customer tax exemptions; tax-inclusive pricing
- Loyalty / gift cards; advanced custom roles; blind cash counts; multi-location

## 6. Non-goals (for now)
- Full ERP / accounting suite
- Enterprise multi-location chains (single + few locations first)
- Hand-maintained multi-jurisdiction tax tables (integrate an API when needed)
- Native Tap-to-Pay in the browser (platform-impossible; deferred to native shell)

## 7. Constraints & hard requirements
- **FACTA**: printed/emailed card receipts show ≤ last 5 digits, **never** the expiry. Day one.
- **PCI**: target SAQ A — card data goes browser/reader → Stripe directly; our servers never see a PAN.
- **Sales tax** is held in trust; modeled separately from revenue.
- **Browser limits**: Tap-to-Pay and Bluetooth hardware are native-only → sequence late, lead with cash + QR + networked printers.

## 8. Success criteria (MVP)
- A new owner can sign up, add a few items, and complete a cash sale in under 5 minutes.
- A sale completes and prints/emails a correct receipt **with no network connection**, then syncs without duplicating.
- End-of-day Z-report reconciles cash to the penny.
