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
  updateOnlineOrderingSchema,
  type SubmitOnlineOrderInput,
  type SubmitOnlineOrderResult,
  type OnlineOrderActionInput,
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
// Generous for a real customer (retries, a couple of orders) but caps abuse/spam
// on the anonymous endpoint. Reused from the shared Upstash limiter (rate-limit.ts).
const SUBMIT_LIMIT = 8;
const SUBMIT_WINDOW_SECONDS = 60;

/** Best-effort caller IP from the proxy headers (Vercel sets x-forwarded-for). */
async function callerIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
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

  // (2) IP rate limit — before any DB work.
  const ip = await callerIp();
  const limit = await rateLimit(`online-submit:${data.businessId}:${ip}`, {
    limit: SUBMIT_LIMIT,
    windowSeconds: SUBMIT_WINDOW_SECONDS,
  });
  if (!limit.ok) return { error: "rate_limited" };

  // (1) ENABLE-GATE + load tax config (tenant root — not a tenant-scoped model).
  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { onlineOrderingEnabled: true, taxRateBps: true, taxInclusive: true },
  });
  if (!business || !business.onlineOrderingEnabled) return { error: "unavailable" };

  // (6) IDEMPOTENCY fast-path: return the existing order for a repeated clientUuid.
  const existing = await db.order.findUnique({
    where: {
      businessId_clientUuid: { businessId: data.businessId, clientUuid: data.clientUuid },
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
    // fast-path pre-check. Re-read the winner and return its confirmation.
    if (isUniqueViolation(e)) {
      const winner = await db.order.findUnique({
        where: {
          businessId_clientUuid: { businessId: data.businessId, clientUuid: data.clientUuid },
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

/**
 * Apply a status transition (accept / ready / complete / reject) to one online
 * order. `manage`-appropriate: gated on the sale-taking capability (`take_orders`),
 * tenant-scoped, zod-validated. Stock decrements on ACCEPT and is restocked on a
 * REJECT that had been accepted. On COMPLETE the order stays an OPEN sale for the
 * cashier to settle on the register (or it was paid ahead); on REJECT it is VOIDED.
 */
export async function transitionOnlineOrder(input: OnlineOrderActionInput): Promise<void> {
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

  await db.$transaction(async (tx) => {
    // Stock: decrement on ACCEPT; restock on a REJECT that was previously accepted.
    if (data.action === "accept") {
      await adjustStock(tx, data.businessId, order.lines, "decrement");
    } else if (data.action === "reject" && isStockCommittedAt(current)) {
      await adjustStock(tx, data.businessId, order.lines, "increment");
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        onlineStatus: target,
        // A rejected online order is VOIDED so it never counts as a sale; every
        // other transition keeps the order OPEN (unpaid) for register settlement.
        ...(target === "REJECTED" ? { status: "VOIDED" } : {}),
      },
    });
  });

  revalidatePath(`/${data.businessId}/online`);
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
