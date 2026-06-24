import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OrderReceipt } from "./queries";

// --- Mocks ----------------------------------------------------------------
// emailReceipt is exercised with REAL zod + REAL recipient validation, but the
// tenant choke point, the order read, and the Resend send wrapper are stubbed.
// We assert: tenant scoping, recipient validation, the graceful unconfigured
// degrade, and the configured send path (incl. send_failure mapping).
const requireMembership = vi.fn();
const getOrderReceipt = vi.fn();
const isEmailConfigured = vi.fn();
const sendReceiptEmail = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => {
  class ForbiddenError extends Error {}
  return { ForbiddenError, requireMembership: (...a: unknown[]) => requireMembership(...a) };
});
// Only void/refund use these; stub so importing actions.ts doesn't pull in env.
vi.mock("@/lib/operator-guard", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("./queries", () => ({ getOrderReceipt: (...a: unknown[]) => getOrderReceipt(...a) }));
vi.mock("./email", () => ({
  isEmailConfigured: (...a: unknown[]) => isEmailConfigured(...a),
  sendReceiptEmail: (...a: unknown[]) => sendReceiptEmail(...a),
}));

import { emailReceipt } from "./actions";

const BUSINESS_ID = "biz_1";
const ORDER_ID = "order_1";

function fakeReceipt(): OrderReceipt {
  return {
    id: ORDER_ID,
    number: 7,
    createdAt: "2026-06-24T17:00:00.000Z",
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
    lines: [],
    payments: [{ method: "CASH", amountCents: 1083, tenderedCents: 2000, changeCents: 917 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMembership.mockResolvedValue({ role: "OWNER" });
  getOrderReceipt.mockResolvedValue(fakeReceipt());
  isEmailConfigured.mockReturnValue(true);
  sendReceiptEmail.mockResolvedValue({ ok: true });
});

describe("emailReceipt — tenant + lookup", () => {
  it("requires membership of the business before reading the order", async () => {
    await emailReceipt({ businessId: BUSINESS_ID, orderId: ORDER_ID, email: "a@b.com" });
    expect(requireMembership).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("scopes the order read to (businessId, orderId)", async () => {
    await emailReceipt({ businessId: BUSINESS_ID, orderId: ORDER_ID, email: "a@b.com" });
    expect(getOrderReceipt).toHaveBeenCalledWith(BUSINESS_ID, ORDER_ID);
  });

  it("returns order_not_found when the order isn't in this business", async () => {
    getOrderReceipt.mockResolvedValue(null);
    const res = await emailReceipt({ businessId: BUSINESS_ID, orderId: ORDER_ID, email: "a@b.com" });
    expect(res).toEqual({ ok: false, reason: "order_not_found" });
    expect(sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("does NOT send when membership is denied", async () => {
    requireMembership.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(
      emailReceipt({ businessId: BUSINESS_ID, orderId: ORDER_ID, email: "a@b.com" }),
    ).rejects.toThrow();
    expect(getOrderReceipt).not.toHaveBeenCalled();
    expect(sendReceiptEmail).not.toHaveBeenCalled();
  });
});

describe("emailReceipt — recipient validation", () => {
  it("returns invalid_email for a malformed address (zod schema rejects pre-action)", async () => {
    // The action's emailReceiptSchema.parse throws on a non-email; assert it
    // never reaches the provider.
    await expect(
      emailReceipt({ businessId: BUSINESS_ID, orderId: ORDER_ID, email: "nope" }),
    ).rejects.toThrow();
    expect(sendReceiptEmail).not.toHaveBeenCalled();
  });
});

describe("emailReceipt — unconfigured degrade", () => {
  it("returns email_not_configured and never sends when RESEND is unset", async () => {
    isEmailConfigured.mockReturnValue(false);
    const res = await emailReceipt({
      businessId: BUSINESS_ID,
      orderId: ORDER_ID,
      email: "customer@example.com",
    });
    expect(res).toEqual({ ok: false, reason: "email_not_configured" });
    expect(sendReceiptEmail).not.toHaveBeenCalled();
  });
});

describe("emailReceipt — configured send", () => {
  it("sends the rendered receipt to the normalized recipient and returns ok", async () => {
    const res = await emailReceipt({
      businessId: BUSINESS_ID,
      orderId: ORDER_ID,
      email: "  Customer@Example.COM ",
    });
    expect(res).toEqual({ ok: true });
    expect(sendReceiptEmail).toHaveBeenCalledTimes(1);
    const [to, rendered] = sendReceiptEmail.mock.calls[0]!;
    expect(to).toBe("customer@example.com");
    expect(rendered.subject).toContain("Taco Stand");
    expect(rendered.text).toContain("$10.83");
  });

  it("maps a provider failure to send_failed", async () => {
    sendReceiptEmail.mockResolvedValue({ ok: false, reason: "send_failed" });
    const res = await emailReceipt({
      businessId: BUSINESS_ID,
      orderId: ORDER_ID,
      email: "customer@example.com",
    });
    expect(res).toEqual({ ok: false, reason: "send_failed" });
  });
});
