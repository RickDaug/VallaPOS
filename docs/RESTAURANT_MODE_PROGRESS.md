# Restaurant Mode — build progress & resume checklist

Branch: `feat/restaurant-mode` (one big PR when done). Full design: the approved plan
(fullscreen + Store/Restaurant mode + multi-room drag-drop floor plan + open tabs +
per-seat split checks). Committed per-layer and pushed after each layer so we can
always resume from the last green commit.

## ⚠ Before any live/DB testing
Apply the additive migration to Neon (gated — run it yourself from this branch):
```
! npx prisma migrate dev
```
Migration: `prisma/migrations/20260623043550_restaurant_mode_floor_tabs` (additive only:
new enums, FloorRoom/FloorTable/OrderTable tables, nullable Order/OrderLine/Payment cols —
STORE businesses unaffected). Until applied, the app builds/tests fine (Prisma client is
generated), but tab/floor features will 500 against the un-migrated DB.

## Invariants to keep (do not break)
Integer cents; tax bps; server recomputes all totals; every query `requireMembership(businessId)`
+ `where:{businessId}`; reads→queries.ts, writes→actions.ts (zod); pin deps; no new runtime dep.

## Layers
- [x] **L1 Schema + migration** — `prisma/schema.prisma` + migration created (not applied). DONE.
- [ ] **L2 Business mode + Fullscreen** — settings field+UI, nav gating (show Floor in RESTAURANT),
      `fullscreen-toggle.tsx`, manifest `display:fullscreen`+`orientation:any`.
- [ ] **L3 Floor-plan editor (settings, MANAGER+)** — `src/features/floor/{queries,schema,actions}.ts`
      + `FloorPlanEditor.tsx` (rooms, drag/resize canvas via pointer events, 0–100 cap, empty-state steps).
- [ ] **L4 Tab math (pure)** — `src/features/tabs/tab-math.ts` (seat grouping, split-settlement plan,
      remaining balance, all-settled predicate) + tests.
- [ ] **L5 Tab actions + queries** — `src/features/tabs/{queries,actions}.ts` (openTab, addTabLines/
      setQty/remove/assignSeat, mergeTables/transferTab, settleTab whole/by-seat). Refactor price/modifier
      resolution out of `register/actions.ts` into a shared helper.
- [ ] **L6 Floor service view** — `app/(app)/[businessId]/floor/page.tsx` + `FloorService.tsx`.
- [ ] **L7 Table detail / ordering UI** — reuse register catalog/cart/modifier-picker; `TableDetail.tsx`
      (by-seat groups, add/qty/remove/seat/modifiers, merge/transfer, settle with NumberPad + tip).
- [ ] **L8 Tests + verification** — unit (tab-math, floor schema) + action tests (mocked Prisma);
      typecheck+lint+full suite+build green.
- [ ] **L9 Docs + PR** — STATE.md section; open the single PR.

## Resume tip
`git log --oneline feat/restaurant-mode` shows the last completed layer. Each layer commit is
typecheck/lint green. Continue from the first unchecked box above.
