import { describe, it, expect } from "vitest";
import {
  CMD,
  CHARS_PER_LINE,
  formatMoney,
  formatReceipt,
  drawerKick,
  qrCode,
  fromOrderReceipt,
  fromCheckoutReceipt,
  paymentMethodLabel,
  type EscPosReceipt,
} from "./escpos";

// ---------------------------------------------------------------------------
// Byte-search helpers (no printer required — we assert on the stream).
// ---------------------------------------------------------------------------

/** Index of the first occurrence of `needle` in `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return indexOfBytes(haystack, needle) !== -1;
}

/** ASCII-encode a string to bytes for substring assertions. */
function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const sampleReceipt: EscPosReceipt = {
  businessName: "Valla Cafe",
  orderNumber: 42,
  createdAt: "2026-06-25T10:00:00.000Z",
  currency: "USD",
  customerName: "Alex",
  lines: [
    {
      name: "Cheeseburger",
      quantity: 2,
      unitPriceCents: 850,
      lineTotalCents: 1900,
      modifiers: [
        { name: "Extra cheese", priceDeltaCents: 100 },
        { name: "No onions", priceDeltaCents: 0 },
      ],
    },
    {
      name: "Fries",
      quantity: 1,
      unitPriceCents: 350,
      lineTotalCents: 350,
    },
  ],
  subtotalCents: 2250,
  discountCents: 100,
  taxCents: 177,
  tipCents: 300,
  totalCents: 2627,
  payments: [
    {
      methodLabel: "Cash",
      amountCents: 2627,
      tenderedCents: 3000,
      changeCents: 373,
    },
  ],
  qrValue: "https://pay.valla/abc123",
  footer: "Thank you!",
};

// ---------------------------------------------------------------------------
// Command constants.
// ---------------------------------------------------------------------------

describe("ESC/POS command constants", () => {
  it("INIT is ESC @", () => {
    expect([...CMD.INIT]).toEqual([0x1b, 0x40]);
  });

  it("center alignment is ESC a 1", () => {
    expect([...CMD.ALIGN_CENTER]).toEqual([0x1b, 0x61, 0x01]);
  });

  it("paper cut is GS V 66 0", () => {
    expect([...CMD.CUT]).toEqual([0x1d, 0x56, 66, 0]);
  });

  it("drawer kick (pin 2) is ESC p 0 ...", () => {
    expect([...CMD.DRAWER_KICK_PIN2]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});

// ---------------------------------------------------------------------------
// Paper width.
// ---------------------------------------------------------------------------

describe("paper width", () => {
  it("58mm and 80mm differ in chars per line", () => {
    expect(CHARS_PER_LINE[58]).toBe(32);
    expect(CHARS_PER_LINE[80]).toBe(48);
    expect(CHARS_PER_LINE[58]).not.toBe(CHARS_PER_LINE[80]);
  });

  it("formatReceipt reports the resolved width + chars-per-line", () => {
    expect(formatReceipt(sampleReceipt, { paperWidth: 58 }).charsPerLine).toBe(32);
    expect(formatReceipt(sampleReceipt, { paperWidth: 80 }).charsPerLine).toBe(48);
    // default is 80mm
    expect(formatReceipt(sampleReceipt).paperWidth).toBe(80);
  });

  it("encoding note surfaces on the result", () => {
    expect(formatReceipt(sampleReceipt, { encoding: "cp437" }).encoding).toBe("cp437");
    expect(formatReceipt(sampleReceipt).encoding).toBe("ascii");
  });
});

// ---------------------------------------------------------------------------
// Money formatter (mirrors @/lib/money.ts formatMoney).
// ---------------------------------------------------------------------------

describe("formatMoney", () => {
  it("formats integer cents as USD", () => {
    expect(formatMoney(2627)).toBe("$26.27");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(100, "USD")).toBe("$1.00");
  });
});

// ---------------------------------------------------------------------------
// Core stream shape + ordering.
// ---------------------------------------------------------------------------

describe("formatReceipt byte stream", () => {
  const { bytes } = formatReceipt(sampleReceipt, { openDrawer: true });

  it("starts with the init command", () => {
    expect(indexOfBytes(bytes, CMD.INIT)).toBe(0);
  });

  it("contains center, then left alignment in order", () => {
    const center = indexOfBytes(bytes, CMD.ALIGN_CENTER);
    const left = indexOfBytes(bytes, CMD.ALIGN_LEFT);
    expect(center).toBeGreaterThan(-1);
    expect(left).toBeGreaterThan(center);
  });

  it("emphasizes the header with bold + double size", () => {
    expect(includesBytes(bytes, CMD.BOLD_ON)).toBe(true);
    expect(includesBytes(bytes, CMD.SIZE_DOUBLE)).toBe(true);
    expect(includesBytes(bytes, CMD.SIZE_DOUBLE_HEIGHT)).toBe(true);
  });

  it("encodes business name, order number, and timestamp", () => {
    expect(includesBytes(bytes, ascii("Valla Cafe"))).toBe(true);
    expect(includesBytes(bytes, ascii("Order #42"))).toBe(true);
    expect(includesBytes(bytes, ascii("2026-06-25T10:00:00.000Z"))).toBe(true);
  });

  it("encodes line items, qty x unit, and per-line modifiers", () => {
    expect(includesBytes(bytes, ascii("Cheeseburger"))).toBe(true);
    expect(includesBytes(bytes, ascii("2 x $8.50"))).toBe(true);
    expect(includesBytes(bytes, ascii("Extra cheese"))).toBe(true);
    expect(includesBytes(bytes, ascii("No onions"))).toBe(true);
    expect(includesBytes(bytes, ascii("Fries"))).toBe(true);
  });

  it("encodes the totals block", () => {
    expect(includesBytes(bytes, ascii("Subtotal"))).toBe(true);
    expect(includesBytes(bytes, ascii("Discount"))).toBe(true);
    expect(includesBytes(bytes, ascii("Tax"))).toBe(true);
    expect(includesBytes(bytes, ascii("Tip"))).toBe(true);
    expect(includesBytes(bytes, ascii("TOTAL"))).toBe(true);
    expect(includesBytes(bytes, ascii("$26.27"))).toBe(true);
  });

  it("encodes payment method + tender + change", () => {
    expect(includesBytes(bytes, ascii("Cash"))).toBe(true);
    expect(includesBytes(bytes, ascii("Tendered"))).toBe(true);
    expect(includesBytes(bytes, ascii("Change"))).toBe(true);
    expect(includesBytes(bytes, ascii("$3.73"))).toBe(true); // change
  });

  it("includes the QR block when a value is present", () => {
    expect(includesBytes(bytes, qrCode("https://pay.valla/abc123"))).toBe(true);
    expect(includesBytes(bytes, ascii("Scan to pay"))).toBe(true);
  });

  it("fires the drawer kick BEFORE the cut, and ends with the cut", () => {
    const kick = indexOfBytes(bytes, CMD.DRAWER_KICK_PIN2);
    const cut = indexOfBytes(bytes, CMD.CUT);
    expect(kick).toBeGreaterThan(-1);
    expect(cut).toBeGreaterThan(kick);
    // the cut is the final command in the stream
    expect(cut + CMD.CUT.length).toBe(bytes.length);
  });

  it("omits the drawer kick when openDrawer is not set", () => {
    const { bytes: noDrawer } = formatReceipt(sampleReceipt);
    expect(includesBytes(noDrawer, CMD.DRAWER_KICK_PIN2)).toBe(false);
  });

  it("omits the cut when cut:false", () => {
    const { bytes: noCut } = formatReceipt(sampleReceipt, { cut: false });
    expect(includesBytes(noCut, CMD.CUT)).toBe(false);
  });

  it("omits the QR block when no value is given", () => {
    const { bytes: noQr } = formatReceipt({ ...sampleReceipt, qrValue: null });
    expect(includesBytes(noQr, ascii("Scan to pay"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const a = formatReceipt(sampleReceipt, { openDrawer: true, paperWidth: 58 });
    const b = formatReceipt(sampleReceipt, { openDrawer: true, paperWidth: 58 });
    expect(a.bytes).toEqual(b.bytes);
    expect([...a.bytes]).toEqual([...b.bytes]);
  });

  it("58mm vs 80mm produce different streams (line widths differ)", () => {
    const narrow = formatReceipt(sampleReceipt, { paperWidth: 58 }).bytes;
    const wide = formatReceipt(sampleReceipt, { paperWidth: 80 }).bytes;
    expect([...narrow]).not.toEqual([...wide]);
  });
});

// ---------------------------------------------------------------------------
// QR command block.
// ---------------------------------------------------------------------------

describe("qrCode", () => {
  it("selects model 2 and prints the symbol", () => {
    const block = qrCode("hello");
    // GS ( k ... 0x31 0x41 0x32 = select model 2
    expect(includesBytes(block, Uint8Array.of(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00))).toBe(true);
    // print: 0x31 0x51 0x30
    expect(includesBytes(block, Uint8Array.of(0x31, 0x51, 0x30))).toBe(true);
    // embeds the data
    expect(includesBytes(block, ascii("hello"))).toBe(true);
  });

  it("encodes the store length as pL/pH (data length + 3)", () => {
    const data = "x".repeat(10);
    const block = qrCode(data);
    // store command: GS ( k pL pH 0x31 0x50 0x30
    const storeMarker = Uint8Array.of(0x1d, 0x28, 0x6b, 13, 0, 0x31, 0x50, 0x30);
    expect(includesBytes(block, storeMarker)).toBe(true);
  });

  it("is deterministic", () => {
    expect([...qrCode("abc")]).toEqual([...qrCode("abc")]);
  });
});

// ---------------------------------------------------------------------------
// drawerKick helper (fire without a print).
// ---------------------------------------------------------------------------

describe("drawerKick", () => {
  it("inits then pulses pin 2 by default", () => {
    const bytes = drawerKick();
    expect(indexOfBytes(bytes, CMD.INIT)).toBe(0);
    expect(includesBytes(bytes, CMD.DRAWER_KICK_PIN2)).toBe(true);
    expect(includesBytes(bytes, CMD.DRAWER_KICK_PIN5)).toBe(false);
  });

  it("can target pin 5", () => {
    const bytes = drawerKick(5);
    expect(includesBytes(bytes, CMD.DRAWER_KICK_PIN5)).toBe(true);
  });

  it("contains no print/cut commands (drawer-only)", () => {
    const bytes = drawerKick();
    expect(includesBytes(bytes, CMD.CUT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mappers from the app's receipt shapes.
// ---------------------------------------------------------------------------

describe("paymentMethodLabel", () => {
  it("maps known methods", () => {
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("QR")).toBe("QR");
    expect(paymentMethodLabel("MANUAL")).toBe("Other");
    expect(paymentMethodLabel("CARD")).toBe("Card");
  });
  it("passes through unknown methods", () => {
    expect(paymentMethodLabel("WEIRD")).toBe("WEIRD");
  });
});

describe("fromOrderReceipt", () => {
  it("maps an OrderReceipt-like shape into a printable stream", () => {
    const input = fromOrderReceipt(
      {
        number: 7,
        createdAt: "2026-06-25T12:00:00.000Z",
        customerName: null,
        businessName: "Test Shop",
        currency: "USD",
        subtotalCents: 1000,
        discountCents: 0,
        taxCents: 83,
        tipCents: 0,
        totalCents: 1083,
        lines: [
          {
            name: "Widget",
            quantity: 1,
            unitPriceCents: 1000,
            totalCents: 1000,
            modifiers: [{ name: "Gift wrap", priceDeltaCents: 0 }],
          },
        ],
        payments: [
          {
            method: "MANUAL",
            amountCents: 1083,
            tenderedCents: null,
            changeCents: null,
            manualNote: "Check #1234",
          },
        ],
      },
      { qrValue: "pix-key-123", footer: "Come again" },
    );

    expect(input.orderNumber).toBe(7);
    expect(input.payments[0]!.methodLabel).toBe("Other");
    expect(input.qrValue).toBe("pix-key-123");

    const { bytes } = formatReceipt(input);
    expect(includesBytes(bytes, ascii("Test Shop"))).toBe(true);
    expect(includesBytes(bytes, ascii("Order #7"))).toBe(true);
    expect(includesBytes(bytes, ascii("Widget"))).toBe(true);
    expect(includesBytes(bytes, ascii("Other"))).toBe(true);
    expect(includesBytes(bytes, ascii("Ref: Check #1234"))).toBe(true);
    expect(includesBytes(bytes, qrCode("pix-key-123"))).toBe(true);
  });
});

describe("fromCheckoutReceipt", () => {
  it("maps the lean checkout Receipt into a totals-only stream", () => {
    const input = fromCheckoutReceipt(
      {
        number: 99,
        subtotalCents: 500,
        discountCents: 0,
        taxCents: 41,
        tipCents: 0,
        totalCents: 541,
        method: "CASH",
        cashTenderedCents: 600,
        changeCents: 59,
        manualNote: null,
      },
      { businessName: "Quick Mart", createdAt: "2026-06-25T09:00:00.000Z" },
    );

    expect(input.lines).toHaveLength(0);
    expect(input.payments[0]!.methodLabel).toBe("Cash");
    expect(input.payments[0]!.tenderedCents).toBe(600);

    const { bytes } = formatReceipt(input);
    expect(includesBytes(bytes, ascii("Quick Mart"))).toBe(true);
    expect(includesBytes(bytes, ascii("Order #99"))).toBe(true);
    expect(includesBytes(bytes, ascii("TOTAL"))).toBe(true);
    expect(includesBytes(bytes, ascii("Change"))).toBe(true);
  });

  it("non-cash tender has no tendered/change", () => {
    const input = fromCheckoutReceipt(
      {
        number: 1,
        subtotalCents: 100,
        discountCents: 0,
        taxCents: 0,
        tipCents: 0,
        totalCents: 100,
        method: "QR",
        cashTenderedCents: 0,
        changeCents: 0,
        manualNote: null,
      },
      { businessName: "Shop", createdAt: "now" },
    );
    expect(input.payments[0]!.tenderedCents).toBeNull();
    expect(input.payments[0]!.changeCents).toBeNull();
    expect(input.payments[0]!.methodLabel).toBe("QR");
  });
});
