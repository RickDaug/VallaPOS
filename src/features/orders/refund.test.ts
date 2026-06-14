import { describe, it, expect } from "vitest";
import {
  netCollectedByMethod,
  netCollectedTotal,
  planFullReversal,
  planPartialRefund,
  type PaymentMovement,
} from "./refund";

const pay = (method: string, amountCents: number): PaymentMovement => ({ method, amountCents });

describe("netCollectedByMethod", () => {
  it("sums per method", () => {
    const net = netCollectedByMethod([pay("CASH", 1000), pay("CARD", 500), pay("CASH", 200)]);
    expect(net.get("CASH")).toBe(1200);
    expect(net.get("CARD")).toBe(500);
  });

  it("nets prior refund reversals out of the balance", () => {
    const net = netCollectedByMethod([pay("CASH", 1000), pay("CASH", -300)]);
    expect(net.get("CASH")).toBe(700);
  });

  it("drops methods that net to zero or below", () => {
    const net = netCollectedByMethod([pay("CASH", 1000), pay("CASH", -1000), pay("CARD", 500)]);
    expect(net.has("CASH")).toBe(false);
    expect(net.get("CARD")).toBe(500);
  });
});

describe("netCollectedTotal", () => {
  it("sums all positive method balances", () => {
    expect(netCollectedTotal([pay("CASH", 1000), pay("CARD", 500)])).toBe(1500);
  });
  it("excludes already fully-refunded methods", () => {
    expect(netCollectedTotal([pay("CASH", 1000), pay("CASH", -1000)])).toBe(0);
  });
});

describe("planFullReversal", () => {
  it("produces one negative reversal per collected method", () => {
    const reversals = planFullReversal([pay("CASH", 1000), pay("CARD", 500)]);
    expect(reversals).toEqual(
      expect.arrayContaining([
        { method: "CASH", amountCents: -1000 },
        { method: "CARD", amountCents: -500 },
      ]),
    );
    expect(reversals).toHaveLength(2);
  });

  it("reverses only the remaining balance after a prior partial refund", () => {
    const reversals = planFullReversal([pay("CASH", 1000), pay("CASH", -300)]);
    expect(reversals).toEqual([{ method: "CASH", amountCents: -700 }]);
  });

  it("returns no rows for a $0 order (clean void with nothing to reverse)", () => {
    expect(planFullReversal([])).toEqual([]);
  });

  it("the reversals exactly negate the net collected", () => {
    const payments = [pay("CASH", 800), pay("CARD", 1200)];
    const reversed = -planFullReversal(payments).reduce((s, r) => s + r.amountCents, 0);
    expect(reversed).toBe(netCollectedTotal(payments));
  });
});

describe("planPartialRefund", () => {
  it("rejects a non-positive amount", () => {
    expect(planPartialRefund([pay("CASH", 1000)], 0)).toEqual({
      ok: false,
      error: "amount_not_positive",
    });
    expect(planPartialRefund([pay("CASH", 1000)], -5)).toEqual({
      ok: false,
      error: "amount_not_positive",
    });
  });

  it("rejects refunding more than net collected", () => {
    expect(planPartialRefund([pay("CASH", 1000)], 1001)).toEqual({
      ok: false,
      error: "exceeds_net_collected",
    });
  });

  it("rejects when nothing is collected", () => {
    expect(planPartialRefund([], 100)).toEqual({ ok: false, error: "no_collected_payments" });
    expect(planPartialRefund([pay("CASH", 1000), pay("CASH", -1000)], 100)).toEqual({
      ok: false,
      error: "no_collected_payments",
    });
  });

  it("refunds against the single method", () => {
    const plan = planPartialRefund([pay("CASH", 1000)], 300);
    expect(plan).toEqual({ ok: true, reversals: [{ method: "CASH", amountCents: -300 }] });
  });

  it("drains the largest balance first, ties broken by method name", () => {
    // CARD 1500 (largest) drained first, then CASH 1000.
    const plan = planPartialRefund([pay("CASH", 1000), pay("CARD", 1500)], 2000);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reversals).toEqual([
        { method: "CARD", amountCents: -1500 },
        { method: "CASH", amountCents: -500 },
      ]);
      const sum = -plan.reversals.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(2000);
    }
  });

  it("allows refunding exactly the net collected (full via the partial path)", () => {
    const plan = planPartialRefund([pay("CASH", 1000)], 1000);
    expect(plan).toEqual({ ok: true, reversals: [{ method: "CASH", amountCents: -1000 }] });
  });

  it("respects a prior partial refund when bounding the next one", () => {
    // 1000 collected, 400 already refunded → 600 remaining; 700 must be rejected.
    const payments = [pay("CASH", 1000), pay("CASH", -400)];
    expect(planPartialRefund(payments, 700)).toEqual({
      ok: false,
      error: "exceeds_net_collected",
    });
    expect(planPartialRefund(payments, 600)).toEqual({
      ok: true,
      reversals: [{ method: "CASH", amountCents: -600 }],
    });
  });
});
