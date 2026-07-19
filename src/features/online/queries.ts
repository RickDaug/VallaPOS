import "server-only";
import { db } from "@/lib/db";
import { getRegisterCatalog, type SellableEntry } from "@/features/catalog/queries";
import { ACTIVE_ONLINE_STATUSES, type OnlineStatus } from "./status";

/** The merchant's QR-pay handle to display on the confirmation (v1 pay-on-pickup rail). */
export interface PublicQrPay {
  label: string | null;
  value: string;
}

export interface PublicMenu {
  businessId: string;
  name: string;
  currency: string;
  taxRateBps: number;
  taxInclusive: boolean;
  /** Pickup / collection instructions shown on the confirmation screen (or null). */
  instructions: string | null;
  /** The merchant's configured pay-from-your-phone QR (null = pay at pickup). */
  qrPay: PublicQrPay | null;
  /** Sellable catalog entries (one per variation), with stock + linked modifiers. */
  entries: SellableEntry[];
}

/**
 * The PUBLIC menu for the customer self-order page — NO auth. Returns `null` (the
 * page renders `notFound()` → a 404) when the business doesn't exist OR online
 * ordering is disabled, so the feature is completely invisible until a merchant
 * turns it on. Everything returned is intentionally non-sensitive: the public
 * catalog + tax/currency + the merchant's own pay handle. Stock is surfaced on
 * each entry (trackStock/stock) so the UI can mark out-of-stock items; see
 * `src/features/catalog/stock.ts`.
 */
export async function getPublicMenu(businessId: string): Promise<PublicMenu | null> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      currency: true,
      taxRateBps: true,
      taxInclusive: true,
      onlineOrderingEnabled: true,
      onlineOrderInstructions: true,
      qrPayEnabled: true,
      qrPayLabel: true,
      qrPayValue: true,
    },
  });
  // 404 when the business is missing OR the feature is off (inert-by-default).
  if (!business || !business.onlineOrderingEnabled) return null;

  const entries = await getRegisterCatalog(businessId);

  return {
    businessId,
    name: business.name,
    currency: business.currency,
    taxRateBps: business.taxRateBps,
    taxInclusive: business.taxInclusive,
    instructions: business.onlineOrderInstructions,
    qrPay:
      business.qrPayEnabled && business.qrPayValue
        ? { label: business.qrPayLabel, value: business.qrPayValue }
        : null,
    entries,
  };
}

export interface IncomingOrderModifier {
  nameSnapshot: string;
  priceDeltaCents: number;
}

export interface IncomingOrderLine {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  modifiers: IncomingOrderModifier[];
}

export interface IncomingOnlineOrder {
  id: string;
  number: number;
  customerName: string | null;
  customerPhone: string | null;
  onlineStatus: OnlineStatus;
  /** True once a Payment has been recorded (Order.status === "PAID"). Drives the
   *  board's paid chip + whether the "Take payment" control is shown. */
  paid: boolean;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  createdAt: string; // ISO — serialized for the client component
  lines: IncomingOrderLine[];
}

/**
 * The merchant's incoming online orders, oldest first so staff work the queue in
 * order. Tenant-scoped by businessId. Includes the ACTIVE statuses
 * (SUBMITTED / ACCEPTED / READY) AND any COMPLETED order that is still UNPAID
 * (status OPEN) so it stays visible for the merchant to settle — otherwise a
 * completed-but-unsettled order would drop off the board with no way to take
 * payment (the A1 stranded-revenue trap). A PAID or VOIDED order drops off.
 */
export async function listOnlineOrders(businessId: string): Promise<IncomingOnlineOrder[]> {
  const orders = await db.order.findMany({
    where: {
      businessId,
      channel: "ONLINE",
      OR: [
        { onlineStatus: { in: ACTIVE_ONLINE_STATUSES } },
        // Completed but not yet settled — keep it on the board so staff can still
        // take payment (flips it to PAID, then it drops off).
        { onlineStatus: "COMPLETED", status: "OPEN" },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      customerName: true,
      customerPhone: true,
      onlineStatus: true,
      status: true,
      subtotalCents: true,
      taxCents: true,
      tipCents: true,
      totalCents: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          unitPriceCents: true,
          totalCents: true,
          modifiers: { select: { nameSnapshot: true, priceDeltaCents: true } },
        },
      },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    // onlineStatus is non-null here by the query filter; assert the narrowed type.
    onlineStatus: o.onlineStatus as OnlineStatus,
    paid: o.status === "PAID",
    subtotalCents: o.subtotalCents,
    taxCents: o.taxCents,
    tipCents: o.tipCents,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    lines: o.lines,
  }));
}

export interface IncomingOnlineCounts {
  /** New, not-yet-accepted orders (drives the nav badge + "new order" toast). */
  submitted: number;
  /** All still-active online orders (SUBMITTED + ACCEPTED + READY). */
  active: number;
}

/** Lightweight counts for the nav badge / live poller. Tenant-scoped. */
export async function countIncomingOnlineOrders(
  businessId: string,
): Promise<IncomingOnlineCounts> {
  const [submitted, active] = await Promise.all([
    db.order.count({
      where: { businessId, channel: "ONLINE", onlineStatus: "SUBMITTED" },
    }),
    db.order.count({
      where: { businessId, channel: "ONLINE", onlineStatus: { in: ACTIVE_ONLINE_STATUSES } },
    }),
  ]);
  return { submitted, active };
}
