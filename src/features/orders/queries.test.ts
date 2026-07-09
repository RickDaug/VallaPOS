import { describe, it, expect, vi, beforeEach } from "vitest";

// getDailyReport (Z-report) keys its MONEY lines on PAYMENT time (audit #9): a
// cash refund taken today against yesterday's order lands in TODAY's window, and
// yesterday's already-closed report is immutable (the later refund never
// retroactively changes it). The SALES lines still key on the order's createdAt
// (a refund isn't a new sale). We stub @/lib/db with in-memory findMany impls
// that filter exactly like Prisma against the `where` the code builds.

const orderFindMany = vi.fn();
const paymentFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: { findMany: (...a: unknown[]) => orderFindMany(...a) },
    payment: { findMany: (...a: unknown[]) => paymentFindMany(...a) },
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
