import { describe, it, expect } from "vitest";
import { formatReceipt, drawerKick, qrCode, CMD, type EscPosReceipt } from "./escpos";
import { preview, previewToText, type Preview, type PreviewMarker } from "./preview";
import { VirtualTransport } from "./transports/virtual";

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
      lineTotalCents: 1700,
      modifiers: [{ name: "Extra cheese", priceDeltaCents: 100 }],
    },
    { name: "Fries", quantity: 1, unitPriceCents: 350, lineTotalCents: 350 },
  ],
  subtotalCents: 2150,
  discountCents: 100,
  taxCents: 169,
  tipCents: 300,
  totalCents: 2519,
  payments: [{ methodLabel: "Cash", amountCents: 2519, tenderedCents: 3000, changeCents: 481 }],
  qrValue: "https://pay.valla/abc123",
  footer: "Thank you!",
};

/** Capture a receipt's bytes through the VirtualTransport, then render the preview. */
async function renderViaVirtual(
  receipt: EscPosReceipt,
  options?: Parameters<typeof formatReceipt>[1],
): Promise<Preview> {
  const transport = new VirtualTransport();
  const device = await transport.connect({ kind: "printer", transport: "webusb" });
  const { bytes } = formatReceipt(receipt, options);
  await device.print(bytes);
  return preview(transport.capture.bytes);
}

function findLine(p: Preview, substr: string) {
  return p.lines.find((l) => l.text.includes(substr));
}

function findMarker(p: Preview, kind: PreviewMarker["kind"]): PreviewMarker | undefined {
  return p.nodes.find((n): n is PreviewMarker => n.kind === kind);
}

describe("preview — text formatting reconstruction", () => {
  it("renders the business name centered + bold", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    const name = findLine(p, "Valla Cafe");
    expect(name).toBeDefined();
    expect(name?.align).toBe("center");
    expect(name?.bold).toBe(true);
    expect(name?.size).toBe("double");
  });

  it("renders order number + customer name", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    expect(findLine(p, "Order #42")).toBeDefined();
    expect(findLine(p, "Alex")).toBeDefined();
  });

  it("renders line items left-aligned with totals", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    const burger = findLine(p, "Cheeseburger");
    expect(burger).toBeDefined();
    expect(burger?.align).toBe("left");
    expect(burger?.text).toContain("$17.00");
    expect(findLine(p, "Extra cheese")).toBeDefined();
  });

  it("renders the totals block with a bold, double-height TOTAL", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    expect(findLine(p, "Subtotal")?.text).toContain("$21.50");
    expect(findLine(p, "Discount")?.text).toContain("-$1.00");
    expect(findLine(p, "Tax")?.text).toContain("$1.69");
    expect(findLine(p, "Tip")?.text).toContain("$3.00");
    const total = findLine(p, "TOTAL");
    expect(total?.bold).toBe(true);
    expect(total?.size).toBe("double-height");
    expect(total?.text).toContain("$25.19");
  });

  it("renders the cash tender + change + footer", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    expect(findLine(p, "Cash")?.text).toContain("$25.19");
    expect(findLine(p, "Tendered")?.text).toContain("$30.00");
    expect(findLine(p, "Change")?.text).toContain("$4.81");
    expect(findLine(p, "Thank you!")).toBeDefined();
  });
});

describe("preview — markers", () => {
  it("emits a cut marker by default", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    expect(p.nodes.some((n) => n.kind === "cut")).toBe(true);
  });

  it("omits the cut marker when cut:false", async () => {
    const p = await renderViaVirtual(sampleReceipt, { cut: false });
    expect(p.nodes.some((n) => n.kind === "cut")).toBe(false);
  });

  it("emits a QR marker carrying the payload when a qrValue is given", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    const qr = findMarker(p, "qr");
    expect(qr).toBeDefined();
    expect(qr?.data).toBe("https://pay.valla/abc123");
    expect(findLine(p, "Scan to pay")).toBeDefined();
  });

  it("emits no QR marker when qrValue is absent", async () => {
    const p = await renderViaVirtual({ ...sampleReceipt, qrValue: null });
    expect(p.nodes.some((n) => n.kind === "qr")).toBe(false);
  });

  it("emits a drawer-kick marker when openDrawer is set", async () => {
    const p = await renderViaVirtual(sampleReceipt, { openDrawer: true });
    expect(p.nodes.some((n) => n.kind === "drawer-kick")).toBe(true);
  });

  it("emits no drawer-kick marker by default", async () => {
    const p = await renderViaVirtual(sampleReceipt);
    expect(p.nodes.some((n) => n.kind === "drawer-kick")).toBe(false);
  });

  it("marker ordering: QR before cut, drawer-kick before cut", async () => {
    const p = await renderViaVirtual(sampleReceipt, { openDrawer: true });
    const qrIdx = p.nodes.findIndex((n) => n.kind === "qr");
    const kickIdx = p.nodes.findIndex((n) => n.kind === "drawer-kick");
    const cutIdx = p.nodes.findIndex((n) => n.kind === "cut");
    expect(qrIdx).toBeGreaterThanOrEqual(0);
    expect(qrIdx).toBeLessThan(cutIdx);
    expect(kickIdx).toBeLessThan(cutIdx);
  });
});

describe("preview — unit command interpretation", () => {
  it("interprets a standalone drawerKick() stream", () => {
    const p = preview(drawerKick(2));
    expect(p.nodes.filter((n) => n.kind === "drawer-kick").length).toBe(1);
  });

  it("decodes a QR block in isolation", () => {
    const p = preview(qrCode("hello-qr"));
    const qr = findMarker(p, "qr");
    expect(qr?.data).toBe("hello-qr");
  });

  it("interprets a bare cut command", () => {
    const p = preview(CMD.CUT);
    expect(p.nodes.some((n) => n.kind === "cut")).toBe(true);
  });

  it("tracks align + bold + size state across text runs", () => {
    const bytes = new Uint8Array([
      ...CMD.ALIGN_CENTER,
      ...CMD.BOLD_ON,
      ...CMD.SIZE_DOUBLE,
      ...Uint8Array.from("HELLO", (c) => c.charCodeAt(0)),
      0x0a,
      ...CMD.ALIGN_LEFT,
      ...CMD.BOLD_OFF,
      ...CMD.SIZE_NORMAL,
      ...Uint8Array.from("world", (c) => c.charCodeAt(0)),
      0x0a,
    ]);
    const p = preview(bytes);
    expect(p.lines[0]).toMatchObject({
      text: "HELLO",
      align: "center",
      bold: true,
      size: "double",
    });
    expect(p.lines[1]).toMatchObject({
      text: "world",
      align: "left",
      bold: false,
      size: "normal",
    });
  });
});

describe("preview — tolerance", () => {
  it("skips an unknown ESC command and its operand without corrupting text", () => {
    // ESC t 0 (code page) is a known operand-1 command we skip; verify text after it survives.
    const bytes = new Uint8Array([
      0x1b, 0x74, 0x00, // ESC t 0 — skipped
      ...Uint8Array.from("OK", (c) => c.charCodeAt(0)),
      0x0a,
    ]);
    const p = preview(bytes);
    expect(p.lines[0]?.text).toBe("OK");
  });

  it("ignores a truncated trailing ESC", () => {
    const bytes = new Uint8Array([
      ...Uint8Array.from("done", (c) => c.charCodeAt(0)),
      0x0a,
      0x1b, // dangling ESC
    ]);
    const p = preview(bytes);
    expect(p.lines[0]?.text).toBe("done");
  });

  it("produces a stable, deterministic render for the same bytes", () => {
    const { bytes } = formatReceipt(sampleReceipt);
    expect(previewToText(preview(bytes))).toBe(previewToText(preview(bytes)));
  });
});

describe("previewToText", () => {
  it("renders markers as inline tags", async () => {
    const p = await renderViaVirtual(sampleReceipt, { openDrawer: true });
    const text = previewToText(p);
    expect(text).toContain("[QR: https://pay.valla/abc123]");
    expect(text).toContain("[drawer kick]");
    expect(text).toContain("[✂ cut]");
    expect(text).toContain("Valla Cafe");
  });
});
