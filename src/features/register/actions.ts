"use server";

import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { can } from "@/lib/capabilities";
import { computePricedOrder } from "./pricing";
import { resolveOrderLines, type LineInput } from "./resolve-lines";
import { APPROVE_UNVERIFIED_TENDER, verifyManagerApproval } from "./manager-approval";
import {
  checkoutSchema,
  type CheckoutInput,
  type CheckoutResult,
  type Receipt,
  type TenderMethod,
} from "./schema";

// Prisma's unique-constraint code, raised here when two concurrent requests with
// the same clientUuid race past the pre-check and both try to insert on
// @@unique([businessId, clientUuid]). We translate the loser into the existing
// order so checkout stays idempotent (mirrors catalog's isUniqueViolation).
const PRISMA_UNIQUE_VIOLATION = "P2002";

// Audit marker stamped onto a payment's reference when an unverified (QR/MANUAL)
// tender completes via the offline-replay exemption without a manager approval —
// so the Z-report/audit surfaces "approval bypassed (offline replay)" instead of
// silently skipping the gate. See the AUDIT note in `checkout`.
const APPROVAL_BYPASSED_OFFLINE_NOTE = "approval bypassed (offline replay)";

// Audit marker stamped when a replayed OFFLINE sale carried a price snapshot that
// fell below the catalog forgery floor and was clamped up to catalog (Round-3
// #5) — so a tampered-device underprice surfaces on the Z-report/audit instead of
// silently recording the forged amount. See resolveOrderLines' floor logic.
const PRICE_CLAMPED_OFFLINE_NOTE = "price snapshot below catalog floor — clamped (offline replay)";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

// The payment fields toReceipt needs, normalized from either a freshly-built
// payment (success path) or a persisted Payment row (idempotent re-read).
interface PaymentView {
  method: TenderMethod;
  tenderedCents: number | null;
  changeCents: number | null;
  manualNote: string | null;
}

// Normalize a persisted Payment row (idempotency re-read) into a PaymentView.
// `processorRef` doubles as the manual reference note for MANUAL tenders.
function paymentViewOf(
  payment:
    | { method?: string | null; tenderedCents?: number | null; changeCents?: number | null; processorRef?: string | null }
    | undefined,
): PaymentView {
  const m = payment?.method;
  return {
    method: m === "MANUAL" || m === "QR" ? m : "CASH",
    tenderedCents: payment?.tenderedCents ?? null,
    changeCents: payment?.changeCents ?? null,
    manualNote: payment?.processorRef ?? null,
  };
}

/**
 * Complete a sale. The server is the source of truth for money: ONLINE it looks
 * up real variation prices and the business tax rate and recomputes every total
 * — client-sent amounts are never trusted. Idempotent on clientUuid so an
 * offline double-send (or a flaky reconnect) never creates a duplicate sale.
 *
 * ⚠ DELIBERATE, BOUNDED TRUST RELAXATION — OFFLINE PRICE SNAPSHOT (needs human
 * sign-off). A sale rung up while OFFLINE has its cash collected in hand at the
 * price the customer was QUOTED on screen. If the catalog price changes before
 * the queued sale replays, recomputing from the CURRENT price would record a
 * total that diverges from what the customer actually paid. So an offline sale
 * carries a `priceSnapshot` (origin marker `quoted: true` + per-line quoted unit
 * prices / modifier deltas, all zod-bounded & non-negative) and, ONLY then, the
 * server trusts those snapshot UNIT prices as the line/unit source of truth.
 *
 * The relaxation is tightly scoped:
 *  - It applies ONLY when a valid `priceSnapshot` is present (online checkout
 *    sends none and stays byte-for-byte server-authoritative).
 *  - Only per-line UNIT prices + modifier deltas are trusted. Tax is STILL
 *    recomputed from those snapshot prices, and the order total is STILL derived
 *    server-side — a client can't forge an arbitrary total, only quote a price.
 *  - Modifiers are STILL re-validated as existing + linked to the item.
 *  - The snapshot must be index-aligned with `lines` (count must match) or it is
 *    ignored and the catalog price wins (fail safe = server-authoritative).
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const data = checkoutSchema.parse(input);
  // The active operator (PIN-identified) must be allowed to take orders; the sale
  // is attributed to them.
  const operator = await requireCapability(data.businessId, "take_orders");
  const { businessId } = operator;
  // ATTRIBUTION. Online: the sale is the active operator's. Offline replay: it is
  // attributed to whoever RANG it (captured on-device at enqueue as
  // `offlineCashierId`), NOT to whoever is the active operator when the queue
  // drains (Round-3 #3). The captured id is validated as an active member of THIS
  // business before it's trusted; anything missing/invalid falls back to the
  // replaying operator. `requireCapability` above still gates the replaying device
  // (a locked device throws OperatorLockedError → the queue retries later).
  const isOfflineReplay = Boolean(data.priceSnapshot?.quoted);
  let cashierId = operator.membershipId;
  if (isOfflineReplay && data.offlineCashierId) {
    const ringing = await db.membership.findFirst({
      where: { id: data.offlineCashierId, businessId, active: true },
      select: { id: true },
    });
    if (ringing) cashierId = ringing.id;
  }

  // Idempotency: if this clientUuid already produced an order, return it.
  const existing = await db.order.findUnique({
    where: { businessId_clientUuid: { businessId, clientUuid: data.clientUuid } },
    include: { payments: true },
  });
  if (existing) {
    return toReceipt(existing, paymentViewOf(existing.payments[0]));
  }

  // MANAGER-APPROVAL GATE for UNVERIFIED tenders (QR / MANUAL "Other"). Cash is
  // verified (in-drawer) and never gated. For an unverified tender:
  //  - If the active operator already HOLDS `approve_unverified_tender` (an
  //    owner/manager ringing their own sale) → no friction, proceed.
  //  - Otherwise (a cashier) → require a manager-PIN override, verified
  //    server-side against a capability-holding member of THIS business.
  //
  // EXEMPTION — replayed OFFLINE sale: a sale carrying a valid `priceSnapshot`
  // (quoted: true) was already rung + collected on-device and is now replaying;
  // there is no operator at the keyboard to prompt and the money is in hand, so
  // the gate is skipped (mirrors the offline price-trust relaxation). Online
  // checkout sends no snapshot and is fully gated.
  const isUnverifiedTender = data.method === "QR" || data.method === "MANUAL";
  const operatorCanApprove = can(operator.role, operator.permissions, APPROVE_UNVERIFIED_TENDER);
  if (isUnverifiedTender && !isOfflineReplay) {
    if (!operatorCanApprove) {
      if (!data.managerPin) {
        return { error: "manager_approval_required" };
      }
      const approved = await verifyManagerApproval(businessId, data.managerPin);
      if (!approved) {
        return { error: "invalid_manager_pin" };
      }
      // Approved — proceed. Attribution stays the cashier (membershipId), NOT
      // the approving manager.
    }
  }

  // AUDIT: an unverified tender that reaches here via the OFFLINE-REPLAY exemption
  // skipped the live manager-approval gate — there was no operator at the keyboard
  // to re-prompt and the money is already in hand, so the sale legitimately still
  // completes. But an operator who could NOT self-approve (a cashier) having an
  // unverified tender complete with no manager PIN is exactly what the gate exists
  // to catch, so we record an explicit, auditable marker on the payment reference
  // (processorRef, which surfaces on the Z-report/audit) rather than silently
  // skipping it. Cash (verified in-drawer) and self-approving operators are exempt.
  //
  // FOLLOW-UP (deeper fix, not built here): sign the offline price snapshot on the
  // device with a manager-held key at ring time, so replay can cryptographically
  // prove a manager authorized the unverified tender instead of after-the-fact
  // flagging it. That needs device key provisioning + a schema field, out of scope.
  const approvalBypassedOffline =
    isUnverifiedTender && isOfflineReplay && !operatorCanApprove && !data.managerPin;

  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { taxRateBps: true, taxInclusive: true },
  });

  // Resolve REAL prices + modifiers from the DB, scoped to this business (shared
  // with the restaurant tab flow) — for an ONLINE sale client-sent prices are
  // never trusted. For a replayed OFFLINE sale carrying a valid `priceSnapshot`,
  // the quoted unit prices are threaded in as per-line overrides (see the action
  // doc-comment). The snapshot must be index-aligned with `lines` or it's ignored
  // (fail safe = catalog price wins). Modifiers are re-validated either way.
  const snapshot =
    data.priceSnapshot && data.priceSnapshot.lines.length === data.lines.length
      ? data.priceSnapshot
      : undefined;
  const resolveInput: LineInput[] = data.lines.map((line, i) => {
    if (!snapshot) return line;
    const snap = snapshot.lines[i]!;
    return {
      ...line,
      priceOverride: {
        unitPriceCents: snap.unitPriceCents,
        modifierDeltas: snap.modifierDeltas,
      },
    };
  });
  const { moneyLines, lineRecords, snapshotClamped } = await resolveOrderLines(
    businessId,
    resolveInput,
  );

  // Per-line tax is computed once; the order tax is the SUM of line taxes, so
  // Order.taxCents == Σ OrderLine.taxCents by construction (no second compute).
  const priced = computePricedOrder(moneyLines, {
    taxRateBps: business.taxRateBps,
    cartDiscountCents: data.cartDiscountCents,
    tipCents: data.tipCents,
    taxInclusive: business.taxInclusive,
  });
  const totals = priced;

  // Tender resolution. CASH must cover the server total and yields change; every
  // other method (QR, MANUAL/"Other") records the payment as taken out-of-band —
  // no tender, no change, an optional reference note in Payment.processorRef.
  const isCash = data.method === "CASH";
  if (isCash && data.cashTenderedCents < totals.totalCents) {
    throw new Error("Cash tendered is less than the total.");
  }
  const tenderedCents = isCash ? data.cashTenderedCents : null;
  const changeCents = isCash ? data.cashTenderedCents - totals.totalCents : null;
  const note = isCash ? null : data.manualNote?.trim() || null;
  // Fold any offline-replay audit markers into the payment reference so the audit
  // trail carries them (see the AUDIT note above + Round-3 #5). The clamp marker
  // is recorded even on a CASH sale (a forged snapshot can ride any tender), so it
  // may annotate an otherwise-null cash reference. With no markers the reference
  // is byte-for-byte the plain note.
  const markers: string[] = [];
  if (approvalBypassedOffline) markers.push(APPROVAL_BYPASSED_OFFLINE_NOTE);
  if (snapshotClamped) markers.push(PRICE_CLAMPED_OFFLINE_NOTE);
  const reference = markers.length
    ? note
      ? `${note} — ${markers.join(" — ")}`
      : markers.join(" — ")
    : note;

  // OFFLINE REPLAY DATING (Round-3 #4): date the order when it was RUNG, not when
  // it replayed, so reports/Z-totals fall on the real sale day. Only trusted on
  // the offline-replay path and only for a real PAST timestamp (a future/absent
  // value falls back to the DB default now()).
  const ringUpAt =
    isOfflineReplay && data.offlineQueuedAt && data.offlineQueuedAt <= Date.now()
      ? new Date(data.offlineQueuedAt)
      : undefined;

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      // Atomically allocate the next per-business order number. The increment
      // takes a row lock on this business's counter, so two concurrent cashiers
      // are serialized and can never collide on @@unique([businessId, number]).
      // upsert is defensive: a business without a counter row (e.g. created before
      // this table existed) self-heals on its first sale.
      const counter = await tx.orderCounter.upsert({
        where: { businessId },
        create: { businessId, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });
      const number = counter.lastNumber;

      return tx.order.create({
        data: {
          businessId,
          clientUuid: data.clientUuid,
          number,
          status: "PAID",
          cashierId, // who rang the sale (offline replay → the ringing operator)
          // Offline replays date to the ring-up time; online omits this (default now()).
          ...(ringUpAt ? { createdAt: ringUpAt } : {}),
          customerName: data.customerName,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          tipCents: totals.tipCents,
          totalCents: totals.totalCents,
          lines: {
            // lineRecords and priced.lines are index-aligned (same source order).
            create: lineRecords.map((l, i) => {
              const p = priced.lines[i]!;
              return {
                businessId,
                variationId: l.variationId,
                nameSnapshot: l.nameSnapshot,
                unitPriceCents: l.unitPriceCents,
                quantity: l.quantity,
                discountCents: p.discountCents,
                taxCents: p.taxCents, // per-line tax; Σ == Order.taxCents
                totalCents: p.totalCents,
                modifiers: {
                  // Snapshot each chosen modifier so catalog edits never rewrite
                  // sold history (mirrors OrderLine.nameSnapshot/unitPriceCents).
                  create: l.modifiers.map((m) => ({
                    nameSnapshot: m.nameSnapshot,
                    priceDeltaCents: m.priceDeltaCents,
                  })),
                },
              };
            }),
          },
          payments: {
            create: {
              businessId,
              method: data.method,
              status: "CAPTURED",
              amountCents: totals.totalCents,
              tenderedCents,
              changeCents,
              processorRef: reference, // QR/Other reference note (null for cash)
            },
          },
        },
      });
    });
  } catch (e) {
    // Concurrency: another request with the same clientUuid won the insert race
    // after we passed the fast-path pre-check. The DB unique constraint blocks
    // the double-insert; re-read the winner and return its receipt so checkout
    // stays idempotent instead of surfacing an unhandled P2002.
    if (isUniqueViolation(e)) {
      const winner = await db.order.findUnique({
        where: { businessId_clientUuid: { businessId, clientUuid: data.clientUuid } },
        include: { payments: true },
      });
      if (winner) {
        return toReceipt(winner, paymentViewOf(winner.payments[0]));
      }
    }
    throw e;
  }

  return toReceipt(order, {
    method: data.method,
    tenderedCents,
    changeCents,
    manualNote: reference,
  });
}

function toReceipt(
  order: {
    id: string;
    number: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
  },
  payment: PaymentView,
): Receipt {
  return {
    orderId: order.id,
    number: order.number,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    method: payment.method,
    // MANUAL has no cash/change; surface 0 to keep the receipt shape numeric.
    cashTenderedCents: payment.tenderedCents ?? 0,
    changeCents: payment.changeCents ?? 0,
    manualNote: payment.manualNote,
  };
}
