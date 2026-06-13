# VallaPOS — Roadmap

Sequenced for a solo developer. Each phase is shippable on its own. See [`PRD.md`](./PRD.md) for full scope and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the how.

## Phase 0 — Foundation ✅ (this pass)
Blueprint + scaffold. Done:
- [x] Rewritten docs (PRD, architecture, roadmap, state)
- [x] Multi-tenant Prisma schema (cents + basis points; Category→Item→Variation→Modifier; orders/payments/cash drawer)
- [x] Pinned dependencies, configs, `.gitignore`, `.env.example`
- [x] `src/lib` wiring scaffold: env, db, auth, tenant choke point, money
- [x] `app/` route-group skeleton + auth handler + placeholder screens

## Phase 1 — MVP: "ring up a sale, get paid, see today's total"
**Goal:** a new owner signs up, adds items, and completes a cash sale in < 5 min — offline-capable.

1. **DB live:** `prisma migrate dev` against Neon; seed script (demo business + catalog).
2. **Auth flow:** real sign-up / sign-in (Better Auth); create-business on first sign-up; `(app)` layout guards session and loads the business.
3. **Catalog:** Products screen — Category → Item → Variation → Modifier CRUD; item type (product/service); inventory toggle off by default.
4. **Register:** touch cart (add/qty/remove), per-line modifiers, line + cart discounts (% / fixed), tips (15/20/25 + custom/none). Server recomputes totals.
5. **Tax:** single configurable rate (basis points), exclusive, per-line-after-discount, shown separately.
6. **Cash payment:** tender + change due; cash drawer session (open float → expected vs counted → over/short).
7. **Receipt:** on-screen + email; FACTA-safe card display.
8. **Z-report:** net sales, tax collected, payment-method split, cash reconciliation.
9. **PWA:** Serwist SW; catalog + cart + cash offline; IndexedDB queue + idempotent sync endpoint.
10. **Tests:** tenant isolation, totals/tax math, sync idempotency; one Playwright happy path.

## Phase 2 — v1: "a real business tool"
- Roles & permissions (Owner/Manager/Cashier) + manager-PIN override; employee PINs + clock in/out
- Refunds (full/partial, scoped) and voids (capture-keyed, with reasons)
- Split payments (amount / even / by item)
- Reports: sales by item, category, employee; tips by employee; daily auto-summary email
- Appointments for service businesses: calendar + SMS/email reminders + deposits
- **Stripe Terminal** smart reader (card-present; PAN never touches our code)
- Offline card queueing (store-and-forward; per-txn cap + sync deadline + "unsynced" badge)
- Networked receipt printer (WebPRNT/HTTP); SMS receipts
- Optional per-item inventory tracking + low-stock alerts + auto-deduct on sale

## Phase 3 — v2: "depth & differentiation"
- Native/React Native shell for **Tap to Pay** (no-hardware card acceptance)
- Stripe Connect (Standard accounts) for multi-merchant SaaS
- Open/bar tabs with card pre-authorization
- Kitchen Display System (Sent → Fired → Fulfilled)
- Multi-rate tax + Stripe Tax/TaxJar; customer tax exemptions; tax-inclusive pricing
- Loyalty / gift cards; advanced custom roles; blind cash counts; multi-location

## Guiding sequencing rules
- **Money + isolation correctness before features.** Get cents, tax, and tenant scoping right first.
- **Lead with what the browser does well** (cash, QR, offline); sequence native-only payments (Tap to Pay) last.
- **Each phase ends shippable** — no half-built screens behind dead nav.
