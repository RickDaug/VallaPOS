import { describe, it, expect } from "vitest";
import { renderReceiptEmail } from "./receipt-email";
import type { OrderReceipt } from "./queries";

function receipt(overrides: Partial<OrderReceipt> = {}): OrderReceipt {
  return {
    id: "ord_1",
    number: 42,
    createdAt: "2026-06-13T17:00:00.000Z",
    customerName: null,
    status: "PAID",
    subtotalCents: 1000,
    discountCents: 0,
    taxCents: 83,
    tipCents: 0,
    totalCents: 1083,
    businessName: "Taco Stand",
    currency: "USD",
    taxRateBps: 825,
    taxInclusive: false,
    lines: [
      { id: "l1", name: "Taco", quantity: 2, unitPriceCents: 500, discountCents: 0, taxCents: 83, totalCents: 1000, modifiers: [] },
    ],
    payments: [{ method: "CASH", amountCents: 1083, tenderedCents: 2000, changeCents: 917 }],
    ...overrides,
  };
}

describe("renderReceiptEmail", () => {
  it("includes business, order number and total in the subject and bodies", () => {
    const { subject, text, html } = renderReceiptEmail(receipt());
    expect(subject).toContain("Taco Stand");
    expect(subject).toContain("#42");
    expect(text).toContain("$10.83");
    expect(html).toContain("$10.83");
    expect(text).toContain("2 x Taco");
  });

  it("shows the tax rate as a percentage", () => {
    const { text } = renderReceiptEmail(receipt());
    expect(text).toContain("Tax (8.25%)");
  });

  it("labels inclusive tax distinctly", () => {
    const { text } = renderReceiptEmail(receipt({ taxInclusive: true }));
    expect(text).toContain("Tax (incl., 8.25%)");
  });

  it("omits zero discount and tip lines", () => {
    const { text } = renderReceiptEmail(receipt());
    expect(text).not.toContain("Discount");
    expect(text).not.toContain("Tip");
  });

  it("includes discount and tip when present", () => {
    const { text } = renderReceiptEmail(receipt({ discountCents: 100, tipCents: 200 }));
    expect(text).toContain("Discount");
    expect(text).toContain("Tip");
  });

  it("escapes HTML in business and item names", () => {
    const { html } = renderReceiptEmail(
      receipt({
        businessName: "Bob & <b>Sons</b>",
        lines: [
          { id: "l1", name: "<script>", quantity: 1, unitPriceCents: 500, discountCents: 0, taxCents: 0, totalCents: 500, modifiers: [] },
        ],
      }),
    );
    expect(html).toContain("Bob &amp; &lt;b&gt;Sons&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
