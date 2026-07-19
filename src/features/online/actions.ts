"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { rateLimit } from "@/lib/rate-limit";
import { computePricedOrder } from "@/features/register/pricing";
import { resolveOrderLines } from "@/features/register/resolve-lines";
import {
  submitOnlineOrderSchema,
  onlineOrderActionSchema,
  settleOnlineOrderSchema,
  updateOnlineOrderingSchema,
  type SubmitOnlineOrderInput,
  type SubmitOnlineOrderResult,
  type OnlineOrderActionInput,
  type SettleOnlineOrderInput,
  type SettleOnlineOrderResult,
  type UpdateOnlineOrderingInput,
} from "./schema";
import { nextOnlineStatus, isStockCommittedAt, type OnlineStatus } from "./status";

const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

// Public-submit rate limit: at most this many order submissions per IP per window.
// Raised modestly from 8 (A5): a busy venue (food truck, food court) has MANY real
// customers behind ONE shared-NAT public IP, so too tight a per-IP cap throttles
// legitimate ordering. 20/60s still hard-caps spam/abuse on the anonymous endpoint
// while leaving headroom for a real rush. Reused from the shared Upstash limiter.
const SUBMIT_LIMIT = 20;
const SUBMIT_WINDOW_SECONDS = 60;

/**
 * Client IP for rate limiting — derived from a PLATFORM-TRUSTED source (A5).
 *
 * `x-forwarded-for` is a CLIENT-CONTROLLED header: a caller can prepend arbitrary
 * values, so trusting its LEFT-most entry lets an abuser rotate a fake IP per
 * request and slip the per-IP cap entirely. On Vercel the real client IP is the
 * LAST hop the platform appends:
 *  - `x-vercel-forwarded-for` is set by Vercel's edge and is not client-spoofable
 *    (any client-sent copy is overwritten) — prefer it when present.
 *  - Otherwise take the RIGHT-most entry of `x-forwarded-for` (the hop closest to
 *    our trusted proxy), NOT the left-most (which the client can forge).
 * Falls back to `x-real-ip`, then a constant so the limiter still shares one bucket.
 */
async function callerIp(): Promise<string> {
  const h = await headers();
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * PUBLIC, UNAUTHENTICATED customer self-order submit (QR self-ordering).
 *
 * SECURITY MODEL (docs/ONLINE_ORDERING.md) — every one of these is enforced here:
 *  1. ENABLE-GATE: rejected unless the business has `onlineOrderingEnabled` (the
 *     feature is inert-by-default; a disabled/again-missing business → unavailable).
 *  2. IP RATE LIMIT: throttled per caller IP via the shared Upstash limiter.
 *  3. INPUT CAPS: zod bounds line count, per-line quantity, modifier count, and
 *     all string lengths (see submitOnlineOrderSchema).
 *  4. SERVER-AUTHORITATIVE PRICING: every unit price / modifier delta / tax / total
 *     is RE-COMPUTED from the DB via resolveOrderLines + computePricedOrder —
 *     exactly like the register checkout. The client sends NO money amount; unknown
 *     or cross-tenant item/modifier ids are rejected.
 *  5. TENANT SCOPE: the order and all its lookups are scoped to `businessId`.
 *  6. IDEMPOTENT: keyed on `clientUuid` (@@unique([businessId, clientUuid])), incl.
 *     the concurrent P2002 race — a double-tap never places two orders.
 *
 * The order is created OPEN + UNPAID with channel=ONLINE, onlineStatus=SUBMITTED,
 * cashierId=null. STOCK IS **NOT** DECREMENTED HERE — it moves on staff ACCEPT
 * (avoids losing inventory to spam / abandoned orders). Returns only a
 * non-sensitive confirmation (number + total); no cross-customer data.
 */
export async function submitOnlineOrder(
  input: SubmitOnlineOrderInput,
): Promise<SubmitOnlineOrderResult> {
  const data = submitOnlineOrderSchema.parse(input);

  // (2) IP rate limit — before any DB work. FAIL-CLOSED (A5): this limiter is the
  // SOLE guard on an anonymous write, so a Redis outage must fall back to a strict
  // in-memory counter (`onError: "memory"`) rather than removing all throttling.
  const ip = await callerIp();
  const limit = await rateLimit(`online-submit:${data.businessId}:${ip}`, {
    limit: SUBMIT_LIMIT,
    windowSeconds: SUBMIT_WINDOW_SECONDS,
    onError: "memory",
  });
  if (!limit.ok) return { error: "rate_limited" };

  // (1) ENABLE-GATE + load tax config (tenant root — not a tenant-scoped model).
  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { onlineOrderingEnabled: true, taxRateBps: true, taxInclusive: true },
  });
  if (!business || !business.onlineOrderingEnabled) return { error: "unavailable" };

  // (6) IDEMPOTENCY fast-path: return the existing order for a repeated clientUuid.
  // CHANNEL-SCOPED (#16): the (businessId, clientUuid) namespace is SHARED with
  // register/offline orders, so a `findUnique` on that key could read back an
  // in-person order's number/total to an anonymous caller who guessed/reused its
  // UUID. Scope the read to `channel: "ONLINE"` (a `findFirst`, since the unique
  // index isn't channel-aware) so only this feature's own orders are ever surfaced.
  const existing = await db.order.findFirst({
    where: {
      businessId: data.businessId,
      clientUuid: data.clientUuid,
      channel: "ONLINE",
    },
    select: { id: true, number: true, totalCents: true },
  });
  if (existing) {
    return { orderId: existing.id, number: existing.number, totalCents: existing.totalCents };
  }

  // (4) SERVER-AUTHORITATIVE PRICING — recompute from the DB, scoped to businessId.
  // An unknown/foreign item or modifier (or an unsatisfied required group) throws;
  // we translate that into a generic `invalid` so the public endpoint leaks nothing.
  let priced;
  let lineRecords;
  try {
    const resolved = await resolveOrderLines(
      data.businessId,
      data.lines.map((l) => ({
        variationId: l.variationId,
        quantity: l.quantity,
        modifierIds: l.modifierIds,
      })),
    );
    lineRecords = resolved.lineRecords;
    priced = computePricedOrder(resolved.moneyLines, {
      taxRateBps: business.taxRateBps,
      tipCents: data.tipCents,
      taxInclusive: business.taxInclusive,
    });
  } catch {
    return { error: "invalid" };
  }

  // Create the order graph. Number is allocated by the same atomic per-business
  // counter as checkout (row-locked increment → no collisions). NO payment row
  // (unpaid) and NO stock decrement (deferred to ACCEPT).
  let order;
  try {
    order = await db.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { businessId: data.businessId },
        create: { businessId: data.businessId, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });
      return tx.order.create({
        data: {
          businessId: data.businessId,
          clientUuid: data.clientUuid,
          number: counter.lastNumber,
          status: "OPEN",
          channel: "ONLINE",
          onlineStatus: "SUBMITTED",
          cashierId: null,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          taxCents: priced.taxCents,
          tipCents: priced.tipCents,
          totalCents: priced.totalCents,
          lines: {
            create: lineRecords.map((l, i) => {
              const p = priced.lines[i]!;
              return {
                businessId: data.businessId,
                variationId: l.variationId,
                nameSnapshot: l.nameSnapshot,
                unitPriceCents: l.unitPriceCents,
                quantity: l.quantity,
                discountCents: p.discountCents,
                taxCents: p.taxCents,
                totalCents: p.totalCents,
                modifiers: {
                  create: l.modifiers.map((m) => ({
                    nameSnapshot: m.nameSnapshot,
                    priceDeltaCents: m.priceDeltaCents,
                  })),
                },
              };
            }),
          },
        },
        select: { id: true, number: true, totalCents: true },
      });
    });
  } catch (e) {
    // (6) Concurrency: a same-clientUuid submit won the insert race after our
    // fast-path pre-check. Re-read the winner and return its confirmation. Kept
    // channel-scoped (#16) — the winner we surface must be an ONLINE order, never a
    // colliding in-person one (a cross-channel UUID clash is astronomically
    // unlikely and would fall through to a rethrow rather than leak anything).
    if (isUniqueViolation(e)) {
      const winner = await db.order.findFirst({
        where: {
          businessId: data.businessId,
          clientUuid: data.clientUuid,
          channel: "ONLINE",
        },
        select: { id: true, number: true, totalCents: true },
      });
      if (winner) {
        return { orderId: winner.id, number: winner.number, totalCents: winner.totalCents };
      }
    }
    throw e;
  }

  // Surface the new order on the merchant board immediately.
  revalidatePath(`/${data.businessId}/online`);
  return { orderId: order.id, number: order.number, totalCents: order.totalCents };
}

// ── Merchant-side transitions (gated by the sale-taking capability) ────────────

interface TransitionLine {
  variationId: string | null;
  quantity: number;
}

/**
 * Adjust on-hand stock for an online order's lines. Only lines whose variation
 * still exists AND whose parent item tracks stock are moved; oversell is allowed
 * (a count may go negative), matching the register's checkout behavior. The
 * variation lookup is scoped to `businessId`.
 */
async function adjustStock(
  tx: Prisma.TransactionClient,
  businessId: string,
  lines: TransitionLine[],
  direction: "increment" | "decrement",
): Promise<void> {
  const ids = lines.map((l) => l.variationId).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return;
  const variations = await tx.variation.findMany({
    where: { businessId, id: { in: ids } },
    select: { id: true, item: { select: { trackStock: true } } },
  });
  const tracked = new Map(variations.map((v) => [v.id, v.item.trackStock]));
  for (const l of lines) {
    if (!l.variationId || !tracked.get(l.variationId)) continue;
    await tx.variation.update({
      where: { id: l.variationId },
      data: { stock: { [direction]: l.quantity } },
    });
  }
}

/** Outcome of a merchant transition — whether it applied or was already done. */
export interface TransitionResult {
  /** "applied" = we moved it this call; "already" = a concurrent call beat us to it. */
  status: "applied" | "already";
}

/**
 * Apply a status transition (accept / ready / complete / reject) to one online
 * order. `manage`-appropriate: gated on the sale-taking capability (`take_orders`),
 * tenant-scoped, zod-validated. Stock decrements on ACCEPT and is restocked on a
 * REJECT that had been accepted. On COMPLETE the order stays an OPEN sale to be
 * settled (see `settleOnlineOrder`) or was paid ahead; on REJECT it is VOIDED.
 *
 * CONCURRENCY (A4): the status change is a GUARDED compare-and-set —
 * `updateMany({ where: { …, onlineStatus: current }, … })` — inside the tx, and
 * stock ONLY moves when that update actually applied (`count === 1`). Two staff
 * (or a double-tap) both "Accept"-ing the same SUBMITTED order therefore decrement
 * stock EXACTLY ONCE: the loser's guarded update matches zero rows (the row is no
 * longer at `current`) and is treated as an already-transitioned no-op rather than
 * re-running `adjustStock`. Previously the read was outside the tx with no CAS, so
 * both writers decremented.
 */
export async function transitionOnlineOrder(
  input: OnlineOrderActionInput,
): Promise<TransitionResult> {
  const data = onlineOrderActionSchema.parse(input);
  await requireCapability(data.businessId, "take_orders");

  // Tenant-scoped ownership check + the data needed to move stock.
  const order = await db.order.findFirst({
    where: { id: data.orderId, businessId: data.businessId, channel: "ONLINE" },
    select: {
      id: true,
      onlineStatus: true,
      lines: { select: { variationId: true, quantity: true } },
    },
  });
  if (!order || !order.onlineStatus) throw new Error("Online order not found.");

  const current = order.onlineStatus as OnlineStatus;
  const target = nextOnlineStatus(current, data.action);
  if (!target) {
    throw new Error(`Cannot ${data.action} an order that is ${current}.`);
  }

  const applied = await db.$transaction(async (tx) => {
    // GUARDED compare-and-set: flip the status ONLY while it is still `current`.
    // A concurrent transition that already moved the row makes this match 0 rows.
    const res = await tx.order.updateMany({
      where: {
        id: order.id,
        businessId: data.businessId,
        channel: "ONLINE",
        onlineStatus: current,
      },
      data: {
        onlineStatus: target,
        // A rejected online order is VOIDED so it never counts as a sale; every
        // other transition keeps the order OPEN (unpaid) until it is settled.
        ...(target === "REJECTED" ? { status: "VOIDED" } : {}),
      },
    });
    if (res.count !== 1) return false; // already transitioned — do NOT move stock.

    // Stock: decrement on ACCEPT; restock on a REJECT that was previously accepted.
    // Runs at most once per real transition because of the guard above.
    if (data.action === "accept") {
      await adjustStock(tx, data.businessId, order.lines, "decrement");
    } else if (data.action === "reject" && isStockCommittedAt(current)) {
      await adjustStock(tx, data.businessId, order.lines, "increment");
    }
    return true;
  });

  revalidatePath(`/${data.businessId}/online`);
  return { status: applied ? "applied" : "already" };
}

/**
 * SETTLE an online order (A1): record a `Payment` at the order's server-stored
 * total and flip it to `PAID`, in ONE transaction, WITHOUT touching stock (stock
 * already moved on ACCEPT). This is what turns a completed self-order into realized
 * revenue/tax — the Z-report and tax/item reports all filter `status = "PAID"`, so
 * before this an ONLINE order was stranded `OPEN` forever (no `PAID` writer existed
 * for it: the register creates a NEW sale and `settleTab` is restaurant-floor-only).
 *
 * `take_orders`-gated, tenant-scoped, zod-validated. `method` ∈ CASH|QR|MANUAL
 * ("Other") — recorded exactly like the register's non-cash/manual tenders
 * (amount = order total, no tendered/change). An optional staff `tipCents` is added
 * on top of the stored total (bounded by the same hard cap as the public tip).
 *
 * IDEMPOTENT + concurrency-safe: the flip is a guarded
 * `updateMany({ where: { status: "OPEN" }, … })`, so a double-tap / two-staff race
 * writes exactly ONE payment — the loser matches 0 rows and returns `already_paid`.
 */
export async function settleOnlineOrder(
  input: SettleOnlineOrderInput,
): Promise<SettleOnlineOrderResult> {
  const data = settleOnlineOrderSchema.parse(input);
  await requireCapability(data.businessId, "take_orders");

  // Tenant-scoped ownership + the server-authoritative total we'll capture.
  const order = await db.order.findFirst({
    where: { id: data.orderId, businessId: data.businessId, channel: "ONLINE" },
    select: { id: true, status: true, totalCents: true },
  });
  if (!order) throw new Error("Online order not found.");
  if (order.status === "VOIDED") {
    throw new Error("Cannot take payment on a rejected order.");
  }
  if (order.status === "PAID") {
    return { status: "already_paid", totalCents: order.totalCents };
  }

  const capturedTotal = order.totalCents + data.tipCents;

  const applied = await db.$transaction(async (tx) => {
    // GUARDED flip: only settle while still OPEN, so a concurrent settle can't
    // double-write a Payment (the loser matches 0 rows).
    const res = await tx.order.updateMany({
      where: { id: order.id, businessId: data.businessId, channel: "ONLINE", status: "OPEN" },
      data: {
        status: "PAID",
        ...(data.tipCents > 0
          ? { tipCents: { increment: data.tipCents }, totalCents: { increment: data.tipCents } }
          : {}),
      },
    });
    if (res.count !== 1) return false;

    await tx.payment.create({
      data: {
        businessId: data.businessId,
        orderId: order.id,
        method: data.method,
        status: "CAPTURED",
        amountCents: capturedTotal,
      },
    });
    return true;
  });

  if (!applied) return { status: "already_paid", totalCents: order.totalCents };

  revalidatePath(`/${data.businessId}/online`);
  return { status: "paid", totalCents: capturedTotal };
}

/**
 * Settings: toggle online ordering + set pickup instructions. `manage_settings`-
 * gated, tenant-scoped, zod-validated. Toggling ON is what makes the public
 * /order/[businessId] page reachable; OFF returns it to a 404.
 */
export async function updateOnlineOrdering(input: UpdateOnlineOrderingInput): Promise<void> {
  const data = updateOnlineOrderingSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_settings");

  await db.business.update({
    where: { id: ctx.businessId },
    data: {
      onlineOrderingEnabled: data.onlineOrderingEnabled,
      onlineOrderInstructions: data.onlineOrderInstructions ?? null,
    },
  });

  revalidatePath(`/${ctx.businessId}/settings`);
  revalidatePath(`/${ctx.businessId}/online`);
}
