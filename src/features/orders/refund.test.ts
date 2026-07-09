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

  it("allocates proportionally across the actual tenders (rows largest first)", () => {
    // total 2500; a 2000 refund splits 1500/2500 to CARD and 1000/2500 to CASH.
    const plan = planPartialRefund([pay("CASH", 1000), pay("CARD", 1500)], 2000);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reversals).toEqual([
        { method: "CARD", amountCents: -1200 },
        { method: "CASH", amountCents: -800 },
      ]);
      const sum = -plan.reversals.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(2000);
    }
  });

  it("SAFE split-tender: never refunds the whole amount as cash on a cash+QR order", () => {
    // Customer paid half cash, half QR. A 500 refund must NOT come back as 500
    // cash (the old 'largest balance first' policy did exactly that on a tie).
    const plan = planPartialRefund([pay("CASH", 500), pay("QR", 500)], 500);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      // Proportional: 250 off each tender. No method exceeds what was paid on it.
      expect(plan.reversals).toEqual([
        { method: "CASH", amountCents: -250 },
        { method: "QR", amountCents: -250 },
      ]);
    }
  });

  it("distributes leftover cents by largest fractional part (ties by method name)", () => {
    // 51 across two equal 100 balances → 25.5 each; the odd cent goes to CASH
    // (tie on fraction, CASH sorts before QR). Reversals still sum to -51.
    const plan = planPartialRefund([pay("CASH", 100), pay("QR", 100)], 51);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reversals).toEqual([
        { method: "CASH", amountCents: -26 },
        { method: "QR", amountCents: -25 },
      ]);
      const sum = -plan.reversals.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(51);
    }
  });

  it("never allocates a method more than its balance (proportional cap)", () => {
    // A tiny-cash / big-QR order: a large refund can't over-draw the 5c of cash.
    const plan = planPartialRefund([pay("CASH", 5), pay("QR", 995)], 900);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const cash = plan.reversals.find((r) => r.method === "CASH");
      expect(-(cash?.amountCents ?? 0)).toBeLessThanOrEqual(5);
      const sum = -plan.reversals.reduce((s, r) => s + r.amountCents, 0);
      expect(sum).toBe(900);
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
