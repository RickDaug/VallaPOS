import { describe, it, expect, vi, beforeEach } from "vitest";

// getCashCollectedSince aggregates CASH Payment.amountCents over a time window.
// The fix (audit #9) keys that window on the PAYMENT's OWN createdAt, not the
// order's — so a tab opened before the drawer session but SETTLED in cash during
// it counts in this drawer. We stub @/lib/db with an in-memory payment.aggregate
// that filters exactly like Prisma would against the `where` the code builds, so
// the assertions exercise the real filter semantics (revert to order.createdAt
// keying and these tests fail).

const paymentAggregate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    payment: { aggregate: (...a: unknown[]) => paymentAggregate(...a) },
    cashDrawerSession: {},
    membership: {},
  },
}));

import { getCashCollectedSince } from "./queries";

const BIZ = "biz_1";

interface FakePayment {
  businessId: string;
  method: string;
  amountCents: number;
  createdAt: Date; // the PAYMENT's own timestamp (settlement time)
  order: { businessId: string; createdAt: Date }; // order-open time
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withinWindow(value: Date, w: any): boolean {
  if (!w) return true;
  if (w.gte && value < w.gte) return false;
  if (w.lt && value >= w.lt) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matches(p: FakePayment, where: any): boolean {
  if (where.businessId && p.businessId !== where.businessId) return false;
  if (where.method && p.method !== where.method) return false;
  if (!withinWindow(p.createdAt, where.createdAt)) return false;
  if (where.order) {
    if (where.order.businessId && p.order.businessId !== where.order.businessId) return false;
    if (!withinWindow(p.order.createdAt, where.order.createdAt)) return false;
  }
  return true;
}

function seed(payments: FakePayment[]) {
  paymentAggregate.mockImplementation(async ({ where }: { where: unknown }) => {
    const sum = payments
      .filter((p) => matches(p, where))
      .reduce((s, p) => s + p.amountCents, 0);
    return { _sum: { amountCents: sum } };
  });
}

const openedAt = new Date("2026-07-07T09:00:00Z");
const end = new Date("2026-07-07T17:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCashCollectedSince — keyed on payment time (audit #9)", () => {
  it("counts a tab OPENED before the session but SETTLED in cash during it", async () => {
    seed([
      // Tab opened an hour before the drawer opened, paid cash mid-session.
      {
        businessId: BIZ,
        method: "CASH",
        amountCents: 2000,
        createdAt: new Date("2026-07-07T09:30:00Z"), // during session
        order: { businessId: BIZ, createdAt: new Date("2026-07-07T08:00:00Z") }, // before open
      },
    ]);
    // Payment time is inside [openedAt, end) → it belongs to THIS drawer.
    expect(await getCashCollectedSince(BIZ, openedAt, end)).toBe(2000);
  });

  it("excludes a payment settled after the window even if its order opened inside", async () => {
    seed([
      {
        businessId: BIZ,
        method: "CASH",
        amountCents: 5000,
        createdAt: new Date("2026-07-07T18:00:00Z"), // after end → next session
        order: { businessId: BIZ, createdAt: new Date("2026-07-07T10:00:00Z") }, // opened inside
      },
    ]);
    expect(await getCashCollectedSince(BIZ, openedAt, end)).toBe(0);
  });

  it("nets a cash refund (negative CASH payment) settled during the window", async () => {
    seed([
      {
        businessId: BIZ,
        method: "CASH",
        amountCents: 3000,
        createdAt: new Date("2026-07-07T10:00:00Z"),
        order: { businessId: BIZ, createdAt: new Date("2026-07-07T10:00:00Z") },
      },
      {
        businessId: BIZ,
        method: "CASH",
        amountCents: -1000, // refund reversal
        createdAt: new Date("2026-07-07T11:00:00Z"),
        order: { businessId: BIZ, createdAt: new Date("2026-07-06T10:00:00Z") }, // yesterday's order
      },
    ]);
    expect(await getCashCollectedSince(BIZ, openedAt, end)).toBe(2000);
  });

  it("builds a tenant-scoped, payment-time window (not an order.createdAt window)", async () => {
    seed([]);
    await getCashCollectedSince(BIZ, openedAt, end);
    const where = paymentAggregate.mock.calls[0]![0].where;
    expect(where.businessId).toBe(BIZ);
    expect(where.method).toBe("CASH");
    // The window is on the PAYMENT's own createdAt…
    expect(where.createdAt).toEqual({ gte: openedAt, lt: end });
    // …NOT on the order's createdAt (which only carries the tenant backstop).
    expect(where.order?.createdAt).toBeUndefined();
    expect(where.order?.businessId).toBe(BIZ);
  });
});
