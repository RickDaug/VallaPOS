import { describe, expect, it } from "vitest";
import {
  buildOrderReceiptBytes,
  printOrderReceipt,
  printOrderById,
  type ReceiptPrinter,
} from "./auto-print";
import { formatReceipt, fromOrderReceipt, type OrderReceiptLike } from "./escpos";

const ORDER: OrderReceiptLike = {
  number: 7,
  createdAt: "2026-07-13T12:00:00.000Z",
  customerName: null,
  businessName: "Rosa's Tacos",
  currency: "USD",
  subtotalCents: 500,
  discountCents: 0,
  taxCents: 41,
  tipCents: 0,
  totalCents: 541,
  lines: [{ name: "Burger", quantity: 1, unitPriceCents: 500, totalCents: 500, modifiers: [] }],
  payments: [{ method: "CASH", amountCents: 541, tenderedCents: 1000, changeCents: 459, manualNote: null }],
};

describe("auto-print", () => {
  it("buildOrderReceiptBytes equals formatReceipt(fromOrderReceipt) with openDrawer+cut on", () => {
    const bytes = buildOrderReceiptBytes(ORDER);
    const expected = formatReceipt(fromOrderReceipt(ORDER), {
      openDrawer: true,
      cut: true,
      paperWidth: undefined,
    }).bytes;
    expect(Array.from(bytes)).toEqual(Array.from(expected));
  });

  it("honors openDrawer:false (fewer bytes than the drawer-kick variant)", () => {
    const withKick = buildOrderReceiptBytes(ORDER, { openDrawer: true });
    const noKick = buildOrderReceiptBytes(ORDER, { openDrawer: false });
    expect(noKick.length).toBeLessThan(withKick.length);
  });

  it("printOrderReceipt sends the built bytes to the printer", async () => {
    let sent: Uint8Array | undefined;
    const printer: ReceiptPrinter = {
      print: async (bytes) => {
        sent = bytes;
      },
    };
    const bytes = await printOrderReceipt(printer, ORDER, { openDrawer: false });
    expect(sent).toBeInstanceOf(Uint8Array);
    expect(Array.from(sent!)).toEqual(Array.from(bytes));
  });

  it("printOrderById loads then prints; returns null for a missing order without printing", async () => {
    let prints = 0;
    const printer: ReceiptPrinter = {
      print: async () => {
        prints += 1;
      },
    };
    const getReceipt = async (id: string) => (id === "o1" ? ORDER : null);

    const bytes = await printOrderById({ getReceipt, printer, orderId: "o1" });
    expect(bytes).not.toBeNull();
    expect(prints).toBe(1);

    const miss = await printOrderById({ getReceipt, printer, orderId: "nope" });
    expect(miss).toBeNull();
    expect(prints).toBe(1); // not printed again
  });
});
