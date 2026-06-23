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
- [x] **L2 Business mode + Fullscreen** — settings field+UI, nav gating, `fullscreen-toggle.tsx`,
      manifest fullscreen. DONE.
- [x] **L3 Floor-plan editor (settings, MANAGER+)** — `src/features/floor/{schema,queries,actions}.ts`
      + `components/FloorPlanEditor.tsx` (rooms tabs, drag/resize canvas via pointer events, quick-add,
      0–100 cap, empty-state steps); wired into the settings page. DONE.
- [x] **L4 Tab math (pure)** — `src/features/tabs/tab-math.ts` + 13 tests. DONE.
- [x] **L5 Tab actions + queries** — `register/resolve-lines.ts` (shared resolver, checkout refactored
      onto it), `tabs/{schema,queries,actions}.ts` (openTab, add/setQty/remove/assignSeat lines,
      mergeTables/transferTab, settleTab whole/by-seat closing the tab when fully settled). DONE.
- [x] **L6 Floor service view** — `floor/page.tsx` + `tabs/components/FloorService.tsx` (room tabs,
      status-colored canvas, tap free→openTab→detail, tap occupied→detail). DONE.
- [x] **L7 Table detail / ordering UI** — `floor/[orderId]/page.tsx` (SSR: getTab + catalog + tables)
      + `tabs/components/TableDetail.tsx` (by-seat groups, MenuGrid + modifier picker, qty/remove/
      move-seat, merge/transfer dialog, SettleDialog whole/by-seat with NumberPad + tip). DONE.
- [x] **L8 Tests + verification** — tab-math (13), tab actions (12), floor schema (8); tenant guard
      extended to floorRoom/floorTable. 252 tests + typecheck + lint + build green. DONE.
- [x] **L9 Docs + PR** — STATE.md "Restaurant mode" section; single PR opened. DONE.

## All layers complete — awaiting (1) `! npx prisma migrate dev` and (2) a human browser pass.

## Resume tip
`git log --oneline feat/restaurant-mode` shows the last completed layer. Each layer commit is
typecheck/lint green. Continue from the first unchecked box above.
