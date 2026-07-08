# VallaPOS Improvement Blueprint

_Synthesized from 6 audits (market UX, OSS references, design system, monetization/valuation, UI/UX+a11y, feature-gap+architecture). Last updated 2026-06-12._

> **⚠ 2026-07-08 status note — this blueprint predates most of the work it plans.** It was written when VallaPOS was a cash-only MVP spine (23 tests). Since then **all of Phase 1** and **almost all of Phase 2** have shipped, plus a large amount of Phase 3, none of which is reflected in the "Where we stand" prose below. See `STATE.md` (the source of truth) for the real current state; treat this doc's narrative as **historical framing**. What has landed since 2026-06-12: the full design system + mobile nav (#8), modifiers/variations + per-line tax (#18), refunds/voids, cash-drawer sessions (#16), employee management + PIN + clock-in (#32), reporting depth + CSV (#26), catalog editing depth (#29), register UX uplift — category tabs/numpad/favorites/density/mobile sheet (#34/#57), **offline PWA** (#13), **email receipts** via Resend (#60), **restaurant mode** (floor + tabs + split-settle, #50), a **team operator PIN-lock** model (#54–#56), **peripherals Phase 1** (ESC/POS + WebUSB + Star CloudPRNT + Settings→Devices, hardware-free, #82–#92), **manual/QR tenders** (#62/#64), and the **Stripe Connect onboarding scaffold** (PR-A, #91, dormant). The checkboxes below are updated to `[x]` where the code confirms completion. What genuinely remains: integrated card/QR **processor** payments (direction now locked in `docs/PAYMENTS.md §9`; scaffold shipped, live rail pending user Stripe env), split/partial payments, customer/loyalty (no `Customer` model yet), image tiles + open-tickets, and the Phase 4 fintech-attach growth items.

## Where we stand vs. "best in market"

VallaPOS today is a **correctly-built MVP spine, not a competitive product**: the foundations most startups get wrong — integer-cents money math (23 passing tests), tenant isolation via a `requireMembership` choke point, idempotent transactional checkout, and a forward-looking schema — are genuinely strong. But the application layer only implements the **cash-sale happy path**: the schema is ~70% of a real POS while wired functionality is ~25%. Modifiers, refunds/voids, cash-drawer sessions, multi-payment, and card metadata are all modeled in Prisma yet completely unwired, so several headline features are M-effort UI work rather than redesigns. Visually it is a clean-but-plain MVP with **three disqualifying gaps**: no mobile navigation at all below `lg` (the app is literally unusable on a phone — fatal for a "open a browser and sell" pitch), no async/loading/error states anywhere, and no design tokens, typography, or focus styles. And strategically it has **zero monetization surface** — cash-only, no integrated payments — which is the one thing that actually makes a POS fundable. The gap to best-in-market is breadth + polish + payments, not core correctness; that ordering is our biggest advantage.

---

## Design system decision

**Adopt shadcn/ui + Radix on Tailwind v4, with OKLCH semantic tokens and `next-themes` for light/dark.** This is the right call on our exact stack (Next.js App Router + React 19 + Tailwind v4) for four reasons:

1. **You own the code.** shadcn copies components into the repo (MIT) rather than locking us to a runtime dependency, so we can hard-enforce POS-specific rules — 48px touch targets, `tabular-nums` on all money — without fighting a library's defaults.
2. **Radix solves the expensive, risky a11y parts** (focus trap, ARIA, keyboard nav for Dialog/Tabs/Toast/Select) that we'd otherwise hand-roll and get wrong against WCAG 2.2 AA.
3. **First-class Tailwind v4 + React 19 support** (forwardRef removed, `data-slot` primitives, `@theme` CLI init) — no version friction.
4. **Pairs cleanly with the rest of the toolkit**: Lucide icons (already a dependency), Tremor (Apache-2.0) for dashboards + Recharts (MIT) for custom charts.

**Skip Headless UI** — standardizing on Radix avoids running two primitive systems. **Build the Numpad and CartSheet as custom components** on Radix primitives; they are our POS-specific primitives and not in shadcn.

### Token structure (shadcn-correct Tailwind v4 pattern)

Raw OKLCH values live in `:root` / `.dark`; `@theme inline` maps utilities to `var(--token)` so the `.dark` cascade overrides at runtime. **Do not bake values via plain `@theme`** — that freezes dark mode (the documented "inline gotcha").

- **Brand: "Calm Teal"** — teal-cyan primary, warm-gray neutrals, amber accent. Teal differentiates (competitors are blue/green) while reading financial-trustworthy.
- **Color:** OKLCH primitive ramps (50–950) → semantic tokens (`--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--accent`, `--success`, `--warning`, `--destructive`, `--border`, `--ring`). Components consume **only** semantic tokens. Every `*-foreground` verified ≥4.5:1 (3:1 large/bold). Status never by color alone — always icon + label.
- **Typography:** Inter Variable via `next/font`, `tabular-nums` mandatory on all money/qty. Body 16px floor (POS read at arm's length under glare); totals at 3xl–4xl / weight 700.
- **Spacing/radius/elevation:** 4px ramp; radius `md 10px` default (buttons/inputs), `lg` cards, `xl` dialogs/sheets; 4 soft low-spread shadow levels (we currently use one flat `shadow-sm` everywhere).
- **Touch law:** all interactive controls target 48×48px (44px floor), ≥8px gaps. `:focus-visible` ring 2px `--ring` + 2px offset on **every** interactive element — stop stripping outlines.
- **Motion:** 100–150ms micro, 200–250ms enter/exit, never >300ms; honor `prefers-reduced-motion` (mandatory).

Adoption: `npx shadcn@latest init` → paste token block into `globals.css` (delete shadcn's default neutral palette, replace the lone unused `--color-brand`) → override Button/Input `cva` sizes to our 48/56px heights → add `.numeric` utility → wire `next-themes` (`attribute="class"`, `defaultTheme="system"`, no-flash gate) → CI axe/contrast check on register, checkout, inventory.

---

## Phased plan

Impact = visible quality + revenue/moat leverage. Competitor/OSS references named inline.

### Phase 1 — Facelift / design system (the credibility floor)

> Goal: stop looking like an MVP; fix the things that break the core "sell from a phone" promise.

- [x] **Mobile bottom-tab nav (`lg:hidden`, `fixed bottom-0`, safe-area inset)** in `app/(app)/[businessId]/layout.tsx`. *Today the app is trapped on `/register` below 1024px — this is the single most important fix.* **Impact: High** — done #8 (`app-nav.tsx`).
- [x] **Install shadcn/ui + Radix + token block; wire `next-themes` light/dark.** *Foundation everything else builds on; flips dark mode for free.* **Impact: High** — done #8 (OKLCH "Calm Teal" tokens, `ThemeProvider`/`ThemeToggle`).
- [x] **Load Inter via `next/font`; apply `tabular-nums` to all money/qty.** *Single biggest "looks designed" change per the a11y audit.* **Impact: High** — done #8 (`.numeric` utility).
- [x] **Global `:focus-visible` ring; remove blanket `outline-none`.** *Keyboard/switch users currently can't see focus (WCAG 2.4.7).* **Impact: High** — done #8.
- [x] **Route `loading.tsx` skeletons** for register/orders/products/reports + **`error.tsx`** boundary under `[businessId]`. *Zero async states today; slow networks show a frozen screen.* **Impact: High** — done #8.
- [x] **Extract `Button`/`Card`/`Input`/`Sheet`/`Numpad` primitives** from the duplicated class strings in ~10 files. *Design system in copy-paste strings is fragile and makes redesign expensive.* **Impact: High** — Button/Card/Input/Badge/Skeleton #8; Dialog #21; NumberPad #34; mobile cart Sheet #57.
- [x] **Scope or drop `maximumScale:1`** in `app/layout.tsx` (register-only via body class). *Global zoom-lock fails WCAG 1.4.4.* **Impact: Med** — dropped in #8 (global zoom-lock removed).
- [x] **Fix `text-slate-400` contrast** (page/reports/Register search → slate-500/600). **Impact: Med** — done #8 (converted to tokens).
- [x] **`aria-live` + focus move** on receipt-success and all inline errors; replace `window.confirm()` deletes with a styled Radix dialog + per-row pending state (`ProductsManager.tsx`). **Impact: Med** — `aria-live`/`role` #8; Radix confirm dialog + `useConfirm` #21.
- [x] **Tablet-portrait register layout** (768–1024px): two-column or sticky cart/Charge bar — currently cart hides below the grid until ≥1280px. *Prime POS form factor.* **Impact: Med** — mobile cart Sheet + "View cart" bar #57.
- [x] **Designed empty states** (icon + action link) and **card-reflow the orders table** below `md` (use `replaceAll` for status). **Impact: Med** — orders card-reflow #8; empty states polished across screens #67–#70.

### Phase 2 — Core POS depth (system-of-record breadth)

> Goal: ring real-world orders. Most of this is wiring a schema that already exists.

- [x] **Fix the `Order.number` race** in `src/features/register/actions.ts` — replace `findFirst(max)+1` with a Postgres per-business sequence or atomic counter. *Two concurrent cashiers collide on `@@unique([businessId, number])` today — a real data-integrity bug.* **Impact: High** — done #9 (atomic `OrderCounter` upsert-increment inside the checkout tx).
- [x] **Modifiers + variations in cart** — catalog UI for variations/modifier groups + register picker + un-stub checkout. Adopt Toast's **"open view"** (all modifier groups visible, editable any order) + Square's **auto-progression** through required groups; avoid Clover's "messy modifiers" IA. *Headline gap for the food-truck/coffee persona; `money.ts` already handles `modifierDeltaCents`.* **Impact: High** — done #18 (picker honors min/maxSelect; server re-validates + snapshots).
- [x] **Per-line `taxCents`** populated (currently hardcoded 0). *Prerequisite for correct partial refunds and item-level reporting.* **Impact: Med** — done #18 (`Order.taxCents == Σ OrderLine.taxCents`).
- [x] **Refunds & voids** on the orders page (role-gate to MANAGER via existing `assertRole`); needs per-line tax. *Orders list is read-only today though all REFUNDED/VOIDED enums exist.* **Impact: High** — done (reversing negative Payment rows; drawer/Z-report reconcile).
- [x] **Cash-drawer sessions** — open/close UI + blind count + expected-vs-counted variance in the Z-report. *`CashDrawerSession` is fully modeled with zero code references; critical for cash personas.* **Impact: High** — done #16.
- [ ] **Register UX uplift to competitor standard:** customizable **image+price tile grid** (Square/Shopify/Loyverse), per-device **Favorites** grid, **grid⇄list + density toggle** (Loyverse), **pinned category tabs**, **global type-ahead search** (Toast/Shopify) over name/SKU/barcode, **split-screen cart pane** (Shopify), direct cart-line +/- and swipe-to-void (Square), **open tickets / save cart** synced across devices. *This is where ringing speed and "premium feel" actually live.* **Impact: High** — **mostly done** (#34 pinned category tabs + touch numpad; #57 per-device Favorites + grid⇄list density + mobile cart Sheet; search + split-screen + direct +/- pre-existed). *Still open: image+price tiles and open-tickets/save-cart sync (both need a schema migration).*
- [x] **Catalog editing depth** — edit price, sizes/variations, sort order, archive, stock toggle, attach modifier groups. *UI can only create single "Default"-variation items today.* **Impact: Med** — done #29 (edit item, variations CRUD + reorder, archive/restore); bulk paste-or-type entry added #93.
- [x] **Reporting depth** — sales by item/category/employee, date range, tips-by-employee, CSV export, Tremor charts. *Only a single daily Z-report exists.* **Impact: Med** — done #26 (sales by item/category + RFC-4180 CSV export) + #52 (sales by cashier). *Not done: date-range picker beyond single-day, tips-by-employee, Tremor charts.*
- [x] **Employee management UI + PIN + clock-in/out** (`Membership.pinHash` exists, unused). **Impact: Med** — done #32 (`TimeEntry` model, scrypt PINs, clock-in/out) + the #54–#56 operator PIN-lock model.
- [ ] **Multi-sensory tap confirmation** (haptic + 0.98 press scale + optional sound) on add-to-cart/tender so cashiers trust presses without looking. **Impact: Med** — **partial**: `active:scale-[0.98]` press feedback is applied app-wide (#67–#70); haptic (`navigator.vibrate`) + optional sound not yet implemented.

### Phase 3 — Payments & money (the business turns on)

> Goal: become monetizable. Take rate is commoditized (~2.4–2.6%) — value is **attach % and volume**, not rate. Default-on integrated payments.

- [ ] **Integrated card/QR payments via an embedded-payments partner** (Stripe/Adyen, or payfac-as-a-service Finix/Payrix — partner, don't build PCI/ledgering). Start QR/Payment-Link in browser, Terminal later. Route handler + webhook + payment write path (`PaymentMethod.CARD/QR` + `cardBrand/last4/processorRef` already modeled). **Impact: High** — **in progress**: direction locked to **Stripe Connect (Accounts v2, SaaS/direct charges, no platform fee)** in `docs/PAYMENTS.md §9`; a **confirm-based merchant-configured QR** tender (#64) + **Manual/Other** tender (#62) already ship for v1; the **Connect onboarding scaffold (PR-A, #91)** merged (dormant until `STRIPE_*` env set). *Still open: the processor-backed QR sale rail (PR-C: Checkout Session + webhook) + schema deltas (PR-B).*
- [ ] **Split & partial payments** (model supports many `Payment`s per `Order`; checkout writes exactly one today). **Impact: Med** — restaurant mode does **per-seat split settlement** across multiple payments (#50); general register split/partial payment on a single order is still open.
- [ ] **Ethical high-converting tip screen** — 3 anchored % options + Custom + an **equally prominent No Tip** (hiding No-Tip is a dark pattern); optional combined tip+signature (Toast). *Digital prompts lifted avg tips 15.4%→18.2%.* **Impact: Med** — basic tip presets (15/20/25 + custom + none) exist in the register; the dedicated anchored tip screen + combined signature is not built.
- [x] **Multi-channel receipts** — email (Resend) + SMS + print + none, with redacted pre-populated contact tap-to-edit on repeat customers (Square). *Email receipts are a day-one PRD item, not started.* **Impact: High** — **email done #60** (Resend, dormant until env set) + **printable/thermal receipt** (#11 view, #83–#89 ESC/POS). *Still open: SMS, and repeat-customer contact prefill (needs a `Customer` model).*
- [x] **Thermal printing** — `react-thermal-printer` (ESC/POS over Web Serial/WebUSB) with HTML→print/PDF fallback for email. **Impact: Med** — done #82–#92 (own spec-verified ESC/POS formatter + WebUSB adapter + Star CloudPRNT network path + on-screen preview + Settings→Devices + hardware self-check; hardware-free, awaits one real printer for the physical handshake).
- [x] **Offline-first / PWA** — Workbox cache-first shell + **Dexie (IndexedDB as source of truth)** + background-sync queue replayed via the existing idempotent checkout. *Stated core PRD principle at 0% despite idempotency being done; `idb`/`zustand` are pinned but unused.* **Impact: High** — done #13 (Serwist SW + IndexedDB queue, AES-GCM encrypted at rest #59, quoted-price replay #74); live offline click-through still wants a human pass.
- [ ] **Instant payouts** — first easy, high-attach, near-zero-risk fintech upsell once payments are live. **Impact: Med**

### Phase 4 — Growth & moat (the valuation multiplier)

> Goal: convert system-of-record lock-in into fintech attach and retention.

- [ ] **Customer entity + loyalty + gift cards** (no `Customer` model exists — blocker for loyalty AND CRM AND SMS). Auto-populate profile/history/rewards at checkout (Shopify/Square); contextual "smart tiles" that surface "Redeem reward" only when a customer is attached. **Impact: High (retention)**
- [ ] **Embedded lending / merchant cash advance** via partner (Parafin/Pipe) — underwritten off our own processing data, repaid from daily settlement, sub-3% loss. *The single highest-ROI fintech add-on; Square borrowers use 3.7 products vs 1.5.* **Impact: High**
- [ ] **Business banking + debit card** via BaaS (Unit/Treasury Prime/Lithic) — become the primary financial account (Square: 23% of gross profit). **Impact: High**
- [ ] **Embedded payroll** via partner (Check/Gusto Embedded) — embeds the most painful recurring workflow → retention. **Impact: Med**
- [ ] **Appointments/booking for the barber/salon persona** (`ItemType.SERVICE` exists, no calendar/booking/deposits schema). **Impact: Med-High (per-vertical)**
- [ ] **Accounting integrations** (QuickBooks/Xero) — table stakes for SMB. **Impact: Med**
- [ ] **Nullable `locationId` FK now** to avoid a painful multi-location migration later (cheap to add before more code accretes). **Impact: Med (scaling)**
- [ ] **Guided onboarding wizard + Training/Demo sandbox** (items/users → 50+ mock transactions). *Cuts first-week errors ~40%; "live in 24 hours" is a real SMB differentiator (Clover).* **Impact: Med**
- [ ] **Prisma `$extends` tenant backstop** that throws on unscoped queries (own ARCHITECTURE.md §3 flags this as the load-bearing risk). **Impact: Med (safety)**
- [ ] **Open API + app marketplace** — later-stage ecosystem moat (Toast/Clover); premature now. **Impact: Low (now)**

---

## Valuation levers (what actually makes this fundable)

A POS does not become a unicorn by being a better cash register. It becomes valuable as the merchant's **system of record**, then monetizes **payments + embedded finance** on top of that lock-in. Vertical-SaaS-plus-fintech trades at ~8x revenue vs ~5x horizontal — the premium is paid for embeddedness, retention, and fintech attach, not feature count.

**The levers that move the multiple (priority order):**
1. **Payment attach %** — every other dollar multiplies processing volume. Drive attach toward ~100% of the base; rate is commoditized.
2. **Embedded lending / merchant cash advance** — highest-leverage add-on; raises both revenue and retention (Square loan-takers churn less, attach more).
3. **Business banking + deposit/debit** — converts vendor → primary financial account (Square: 23% of gross profit, ~15% better retention for multi-product users).
4. **Net Revenue Retention** — the #1 investor signal; below ~100% the whole SaaS story collapses. Target 120%+.
5. **Pick ONE vertical and dominate it** (food-truck/QSR vs barber/salon) — the valuation premium *is* verticalization; "POS for everyone" loses to depth.
6. **Rule of 40** + CAC payback <18mo + lending loss <3% — the screening gates post-2022.

**Vanity (do not over-invest):** integration count, "AI" features, slick hardware (treat as CAC, run at a loss to embed), raw GPV headline, breadth of niche modules — none move attach, NRR, or fintech %.

**One-sentence thesis to manage to:** own the vertical's system of record, attach payments to ~100% of it, layer capital and banking on top — and report rising NRR (→120%+), rising fintech-attach %, and a clearing Rule-of-40.

---

## Do first (5 highest-leverage, immediate)

> **✅ 2026-07-08 — all five of these have shipped.** Kept for the record; the current frontier is integrated payments (see below + `docs/PAYMENTS.md §9`).

1. ✅ **Mobile bottom-tab navigation** — unbreaks the core "sell from a phone" promise; the app is currently trapped on `/register` below 1024px. _(Phase 1)_ — done #8.
2. ✅ **Design system in one pass: shadcn/ui + Radix + OKLCH tokens + Inter font + `:focus-visible` ring + light/dark.** Biggest visible jump in perceived quality, and the substrate every later PR builds on. _(Phase 1)_ — done #8.
3. ✅ **`loading.tsx` skeletons + `error.tsx` boundary** across the four main routes — removes the frozen-screen MVP tell instantly. _(Phase 1)_ — done #8.
4. ✅ **Fix the `Order.number` race** in `src/features/register/actions.ts` — a real concurrency data-integrity bug, S-effort, must precede any multi-cashier use. _(Phase 2)_ — done #9 (`OrderCounter`).
5. ✅ **Modifiers + variations in cart** (Toast open-view + Square auto-progression) — the headline functional gap that unlocks the food-truck/coffee persona; the schema and money math are already done. _(Phase 2)_ — done #18.

> After these five, the next strategic milestone is **integrated payments (Phase 3)** — that is the moment VallaPOS becomes monetizable and the valuation story actually begins. **As of 2026-07-08 that milestone is underway:** the payments direction is locked (`docs/PAYMENTS.md §9` — multi-merchant Stripe Connect, flat SaaS subscription, no per-transaction cut) and PR-A (Connect onboarding scaffold) has merged dormant; the live QR sale rail (PR-C) is the next real step, pending the user's Stripe env + go decision.
