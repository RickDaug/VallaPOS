import { describe, it, expect } from "vitest";
import { formatReceipt, drawerKick, type EscPosReceipt } from "../escpos";
import { VirtualTransport, VirtualDevice, VirtualCapture } from "./virtual";

const sampleReceipt: EscPosReceipt = {
  businessName: "Valla Cafe",
  orderNumber: 42,
  createdAt: "2026-06-25T10:00:00.000Z",
  currency: "USD",
  customerName: "Alex",
  lines: [
    { name: "Cheeseburger", quantity: 2, unitPriceCents: 850, lineTotalCents: 1700 },
    { name: "Fries", quantity: 1, unitPriceCents: 350, lineTotalCents: 350 },
  ],
  subtotalCents: 2050,
  discountCents: 0,
  taxCents: 169,
  tipCents: 0,
  totalCents: 2219,
  payments: [{ methodLabel: "Cash", amountCents: 2219, tenderedCents: 2500, changeCents: 281 }],
  qrValue: null,
  footer: "Thank you!",
};

describe("VirtualTransport — provider contract", () => {
  it("exposes the provider identity + supported kinds", () => {
    const t = new VirtualTransport();
    expect(t.id).toBe("virtual");
    expect(t.supportedKinds).toContain("printer");
    expect(t.supportedKinds).toContain("cash_drawer");
  });

  it("connect() returns a VirtualDevice that reports ready, then disconnected", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "printer", transport: "webusb" });
    expect(device).toBeInstanceOf(VirtualDevice);
    expect(await device.status()).toBe("ready");
    expect(device.transport).toBe("webusb");
    await device.disconnect();
    expect(await device.status()).toBe("disconnected");
  });

  it("resolves a registry identity from the target USB ids", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({
      kind: "printer",
      transport: "webusb",
      usb: { vendorId: 0x04b8, productId: 0x0202 },
    });
    expect(device.identity.brand).toBe("epson");
    expect(device.capabilities.protocol).toBe("escpos");
  });
});

describe("VirtualTransport — byte capture", () => {
  it("captures printed bytes verbatim instead of touching hardware", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "printer", transport: "webusb" });
    const { bytes } = formatReceipt(sampleReceipt);

    await device.print(bytes);

    expect(t.capture.printCount).toBe(1);
    expect(t.capture.drawerKickCount).toBe(0);
    expect([...t.capture.bytes]).toEqual([...bytes]);
    expect([...(t.capture.printJobs[0] ?? [])]).toEqual([...bytes]);
  });

  it("copies bytes so later mutation cannot corrupt the log", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "printer", transport: "webusb" });
    const bytes = Uint8Array.of(1, 2, 3);

    await device.print(bytes);
    bytes[0] = 99;

    expect([...(t.capture.printJobs[0] ?? [])]).toEqual([1, 2, 3]);
  });

  it("counts standalone drawer kicks", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "cash_drawer", transport: "webusb" });

    await device.kickDrawer();
    await device.kickDrawer();

    expect(t.capture.drawerKickCount).toBe(2);
    expect(t.capture.printCount).toBe(0);
  });

  it("captures a drawer-kick byte stream as a print job (printer-driven drawer)", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "printer", transport: "webusb" });

    await device.print(drawerKick(2));

    expect(t.capture.printCount).toBe(1);
    expect(t.capture.bytes.length).toBeGreaterThan(0);
  });

  it("shares one capture log across multiple devices from the same provider", async () => {
    const t = new VirtualTransport();
    const a = await t.connect({ kind: "printer", transport: "webusb" });
    const b = await t.connect({ kind: "printer", transport: "network_epos" });

    await a.print(Uint8Array.of(1));
    await b.print(Uint8Array.of(2));

    expect(t.capture.printCount).toBe(2);
    expect([...t.capture.bytes]).toEqual([1, 2]);
  });

  it("rejects I/O after disconnect", async () => {
    const t = new VirtualTransport();
    const device = await t.connect({ kind: "printer", transport: "webusb" });
    await device.disconnect();

    await expect(device.print(Uint8Array.of(1))).rejects.toThrow(/disconnect/);
    await expect(device.kickDrawer()).rejects.toThrow(/disconnect/);
  });

  it("reset() clears the capture log", () => {
    const cap = new VirtualCapture();
    cap.recordPrint(Uint8Array.of(1));
    cap.recordDrawerKick();
    expect(cap.events.length).toBe(2);
    cap.reset();
    expect(cap.events.length).toBe(0);
    expect(cap.printCount).toBe(0);
  });
});
