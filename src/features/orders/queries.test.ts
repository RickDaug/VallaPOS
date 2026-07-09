import { describe, it, expect, vi, beforeEach } from "vitest";

// getDailyReport (Z-report) keys its MONEY lines on PAYMENT time (audit #9): a
// cash refund taken today against yesterday's order lands in TODAY's window, and
// yesterday's already-closed report is immutable (the later refund never
// retroactively changes it). The SALES lines still key on the order's createdAt
// (a refund isn't a new sale). We stub @/lib/db with in-memory findMany impls
// that filter exactly like Prisma against the `where` the code builds.

const orderFindMany = vi.fn();
const paymentFindMany = vi.fn();
const businessFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: { findMany: (...a: unknown[]) => orderFindMany(...a) },
    payment: { findMany: (...a: unknown[]) => paymentFindMany(...a) },
    business: { findUnique: (...a: unknown[]) => businessFindUnique(...a) },
    variation: {},
    membership: {},
  },
}));

import { getDailyReport } from "./queries";

const BIZ = "biz_1";

interface FakeOrder {
  businessId: string;
  status: string;
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  // Payment movements ON the order (positive captures + negative reversals); used
  // to derive the refunded fraction of a PARTIALLY_REFUNDED order.
  payments?: { amountCents: number }[];
}
interface FakePayment {
  businessId: string;
  method: string;
  amountCents: number;
  createdAt: Date; // payment time
  order: { businessId: string; createdAt: Date };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withinWindow(value: Date, w: any): boolean {
  if (!w) return true;
  if (w.gte && value < w.gte) return false;
  if (w.lt && value >= w.lt) return false;
  return true;
}

function seed(orders: FakeOrder[], payments: FakePayment[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orderFindMany.mockImplementation(async ({ where }: { where: any }) => {
    return orders
      .filter((o) => o.businessId === where.businessId)
      .filter((o) => (where.status?.in ? where.status.in.includes(o.status) : true))
      .filter((o) => withinWindow(o.createdAt, where.createdAt))
      .map((o) => ({
        subtotalCents: o.subtotalCents,
        discountCents: o.discountCents,
        taxCents: o.taxCents,
        tipCents: o.tipCents,
        totalCents: o.totalCents,
        payments: o.payments ?? [],
      }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paymentFindMany.mockImplementation(async ({ where }: { where: any }) => {
    return payments
      .filter((p) => p.businessId === where.businessId)
      .filter((p) => withinWindow(p.createdAt, where.createdAt)) // PAYMENT time
      .filter((p) => (where.order?.businessId ? p.order.businessId === where.order.businessId : true))
      .map((p) => ({ method: p.method, amountCents: p.amountCents }));
  });
}

const yStart = new Date("2026-07-06T00:00:00Z");
const yEnd = new Date("2026-07-07T00:00:00Z");
const tStart = new Date("2026-07-07T00:00:00Z");
const tEnd = new Date("2026-07-08T00:00:00Z");

// Yesterday's cash sale of $10, then a $3 cash refund taken TODAY against it.
const orderY: FakeOrder = {
  businessId: BIZ,
  status: "PAID",
  createdAt: new Date("2026-07-06T12:00:00Z"),
  subtotalCents: 1000,
  discountCents: 0,
  taxCents: 0,
  tipCents: 0,
  totalCents: 1000,
};
const saleY: FakePayment = {
  businessId: BIZ,
  method: "CASH",
  amountCents: 1000,
  createdAt: new Date("2026-07-06T12:00:00Z"),
  order: { businessId: BIZ, createdAt: orderY.createdAt },
};
const refundToday: FakePayment = {
  businessId: BIZ,
  method: "CASH",
  amountCents: -300,
  createdAt: new Date("2026-07-07T09:00:00Z"), // settled TODAY
  order: { businessId: BIZ, createdAt: orderY.createdAt }, // against yesterday's order
};

beforeEach(() => {
  vi.clearAllMocks();
  businessFindUnique.mockResolvedValue({ taxInclusive: false });
  seed([orderY], [saleY, refundToday]);
});

describe("getDailyReport — payment-time money window (audit #9)", () => {
  it("lands a cross-day cash refund in TODAY's window (money line), not yesterday's", async () => {
    const today = await getDailyReport(BIZ, tStart, tEnd);
    // No sale was CREATED today, so the sales lines are empty…
    expect(today.orderCount).toBe(0);
    expect(today.grossSalesCents).toBe(0);
    // …but the cash refund settled today reduces cash and shows as a refund.
    expect(today.cashCollectedCents).toBe(-300);
    expect(today.refundsCents).toBe(300);
  });

  it("keeps yesterday's closed report immutable — the later refund doesn't touch it", async () => {
    const yesterday = await getDailyReport(BIZ, yStart, yEnd);
    expect(yesterday.orderCount).toBe(1);
    expect(yesterday.grossSalesCents).toBe(1000);
    // Yesterday still shows the full $10 cash — the refund settled today is NOT
    // retroactively pulled back into yesterday's window.
    expect(yesterday.cashCollectedCents).toBe(1000);
    expect(yesterday.refundsCents).toBe(0);
  });

  it("scopes the payment money-line query by businessId AND payment createdAt", async () => {
    await getDailyReport(BIZ, tStart, tEnd);
    const where = paymentFindMany.mock.calls[0]![0].where;
    expect(where.businessId).toBe(BIZ);
    expect(where.createdAt).toEqual({ gte: tStart, lt: tEnd });
    // The window must NOT be nested under the order relation anymore.
    expect(where.order?.createdAt).toBeUndefined();
    expect(where.order?.businessId).toBe(BIZ);
  });
});

// audit #2 — inclusive-tax "Net sales" must strip the embedded tax so Net + Tax
// doesn't double-count. In inclusive pricing the order subtotal already contains
// the tax; in exclusive pricing it doesn't.
describe("getDailyReport — Net sales by tax mode (audit #2)", () => {
  // A $10 item priced tax-INCLUSIVE at 8.25%: subtotal 1083 embeds 83¢ of tax,
  // total 1083 (tax is inside, not added on top).
  const inclusiveOrder: FakeOrder = {
    businessId: BIZ,
    status: "PAID",
    createdAt: new Date("2026-07-07T12:00:00Z"),
    subtotalCents: 1083,
    discountCents: 0,
    taxCents: 83,
    tipCents: 0,
    totalCents: 1083,
    payments: [{ amountCents: 1083 }],
  };
  // The same economic sale priced tax-EXCLUSIVE: subtotal 1000 pre-tax, tax 83
  // added on top, total 1083.
  const exclusiveOrder: FakeOrder = {
    ...inclusiveOrder,
    subtotalCents: 1000,
    totalCents: 1083,
  };

  it("inclusive: Net = gross − discount − embedded tax, and Net + Tax reconciles to collected", async () => {
    businessFindUnique.mockResolvedValue({ taxInclusive: true });
    seed([inclusiveOrder], []);
    const r = await getDailyReport(BIZ, tStart, tEnd);
    expect(r.grossSalesCents).toBe(1083);
    expect(r.taxCents).toBe(83);
    expect(r.netSalesCents).toBe(1000); // 1083 − 0 − 83, not 1083 (no double-count)
    expect(r.totalCollectedCents).toBe(1083);
    expect(r.netSalesCents + r.taxCents).toBe(r.totalCollectedCents); // reconciles
  });

  it("exclusive: Net = gross − discount (unchanged), Net + Tax reconciles to collected", async () => {
    businessFindUnique.mockResolvedValue({ taxInclusive: false });
    seed([exclusiveOrder], []);
    const r = await getDailyReport(BIZ, tStart, tEnd);
    expect(r.grossSalesCents).toBe(1000);
    expect(r.taxCents).toBe(83);
    expect(r.netSalesCents).toBe(1000);
    expect(r.totalCollectedCents).toBe(1083);
    expect(r.netSalesCents + r.taxCents).toBe(r.totalCollectedCents); // reconciles
  });
});

// audit #3 — a PARTIALLY_REFUNDED order must back the refunded fraction out of
// reported sales AND sales tax (proportional approximation, since refund rows
// carry no tax split), so a merchant remitting off the Z-report doesn't over-remit.
describe("getDailyReport — partial refund backs out reported tax (audit #3)", () => {
  // Exclusive order: subtotal 1000, tax 80 (8%), total 1080. Half is refunded
  // (a -540 reversal), so exactly half the sale and half the tax should remain.
  const partiallyRefunded: FakeOrder = {
    businessId: BIZ,
    status: "PARTIALLY_REFUNDED",
    createdAt: new Date("2026-07-07T12:00:00Z"),
    subtotalCents: 1000,
    discountCents: 0,
    taxCents: 80,
    tipCents: 0,
    totalCents: 1080,
    payments: [{ amountCents: 1080 }, { amountCents: -540 }],
  };

  it("halves reported net + tax when half the order was refunded", async () => {
    seed([partiallyRefunded], []);
    const r = await getDailyReport(BIZ, tStart, tEnd);
    expect(r.grossSalesCents).toBe(500);
    expect(r.taxCents).toBe(40); // 80 backed down to the retained half
    expect(r.netSalesCents).toBe(500);
    expect(r.totalCollectedCents).toBe(540);
    expect(r.orderCount).toBe(1); // the order header still counts as a (reduced) sale
  });

  it("leaves a fully-PAID order (no reversals) reported in full", async () => {
    const paid: FakeOrder = { ...partiallyRefunded, status: "PAID", payments: [{ amountCents: 1080 }] };
    seed([paid], []);
    const r = await getDailyReport(BIZ, tStart, tEnd);
    expect(r.grossSalesCents).toBe(1000);
    expect(r.taxCents).toBe(80);
    expect(r.totalCollectedCents).toBe(1080);
  });
});
