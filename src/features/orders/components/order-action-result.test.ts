import { describe, expect, it } from "vitest";
import { describeRefundVoidResult } from "./order-action-result";
import type { RefundVoidResult } from "@/features/orders/actions";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe("describeRefundVoidResult", () => {
  it("describes a void as a success toast with the reversed amount", () => {
    const res: RefundVoidResult = { ok: true, status: "VOIDED", reversedCents: 1299 };
    expect(describeRefundVoidResult(res, money)).toEqual({
      title: "Order voided",
      description: "$12.99 reversed.",
      variant: "success",
    });
  });

  it("describes a full refund as a success toast", () => {
    const res: RefundVoidResult = { ok: true, status: "REFUNDED", reversedCents: 500 };
    expect(describeRefundVoidResult(res, money)).toEqual({
      title: "Order refunded",
      description: "$5.00 refunded.",
      variant: "success",
    });
  });

  it("describes a partial refund as a success toast", () => {
    const res: RefundVoidResult = {
      ok: true,
      status: "PARTIALLY_REFUNDED",
      reversedCents: 250,
    };
    expect(describeRefundVoidResult(res, money)).toEqual({
      title: "Partial refund issued",
      description: "$2.50 refunded.",
      variant: "success",
    });
  });

  it("maps each failure reason to an error toast with human text", () => {
    const reasons: Extract<RefundVoidResult, { ok: false }>["reason"][] = [
      "order_not_found",
      "not_paid",
      "already_settled",
      "nothing_collected",
      "amount_not_positive",
      "exceeds_net_collected",
    ];
    for (const reason of reasons) {
      const spec = describeRefundVoidResult({ ok: false, reason }, money);
      expect(spec.variant).toBe("error");
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.description).toBeUndefined();
    }
  });

  it("gives a specific message for exceeds_net_collected", () => {
    const spec = describeRefundVoidResult(
      { ok: false, reason: "exceeds_net_collected" },
      money,
    );
    expect(spec.title).toBe("Refund exceeds the amount collected on this order.");
  });
});
