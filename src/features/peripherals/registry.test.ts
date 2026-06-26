import { describe, it, expect } from "vitest";
import {
  VENDOR_IDS,
  brandForVendor,
  defaultCapabilities,
  genericEscPosDevice,
  identifyDevice,
  identifyUsbDevice,
  isKnownDevice,
  listKnownDevices,
} from "./registry";

describe("vendor ids", () => {
  it("uses the verifiable USB-IF vendor ids for Epson and Star", () => {
    expect(VENDOR_IDS.epson).toBe(0x04b8);
    expect(VENDOR_IDS.star).toBe(0x0519);
  });

  it("maps vendor ids to brands, generic otherwise", () => {
    expect(brandForVendor(0x04b8)).toBe("epson");
    expect(brandForVendor(0x0519)).toBe("star");
    expect(brandForVendor(0x1234)).toBe("generic");
  });
});

describe("identifyDevice — known models", () => {
  it("identifies a known Epson TM printer with 80mm caps", () => {
    const dev = identifyDevice(0x04b8, 0x0202);
    expect(dev.brand).toBe("epson");
    expect(dev.model).toBe("TM-T88V");
    expect(dev.kind).toBe("printer");
    expect(dev.capabilities.paperWidthMm).toBe(80);
    expect(dev.capabilities.protocol).toBe("escpos");
    expect(dev.capabilities.hasCutter).toBe(true);
  });

  it("identifies a known Star TSP printer", () => {
    const dev = identifyDevice(0x0519, 0x0003);
    expect(dev.brand).toBe("star");
    expect(dev.model).toContain("TSP143");
    expect(dev.capabilities.paperWidthMm).toBe(80);
    expect(dev.capabilities.hasDrawerKick).toBe(true);
  });

  it("identifies a 58mm Star mC-Print2", () => {
    const dev = identifyDevice(0x0519, 0x0049);
    expect(dev.brand).toBe("star");
    expect(dev.model).toBe("mC-Print2");
    expect(dev.capabilities.paperWidthMm).toBe(58);
  });

  it("identifyUsbDevice takes a struct and returns the same record", () => {
    expect(identifyUsbDevice({ vendorId: 0x04b8, productId: 0x0e15 }).model).toBe("TM-T20II");
  });
});

describe("identifyDevice — fallbacks", () => {
  it("falls back to a brand-tagged ESC/POS device for an un-tabled Epson id", () => {
    const dev = identifyDevice(0x04b8, 0xdead);
    expect(dev.brand).toBe("epson");
    expect(dev.model.toLowerCase()).toContain("epson");
    expect(dev.kind).toBe("printer");
    // Brand fallback keeps the safe ESC/POS 80mm baseline.
    expect(dev.capabilities.protocol).toBe("escpos");
    expect(dev.capabilities.paperWidthMm).toBe(80);
  });

  it("falls back to the unknown generic ESC/POS device for an unknown vendor", () => {
    const dev = identifyDevice(0x9999, 0x0001);
    expect(dev.brand).toBe("generic");
    expect(dev.model).toBe("Unknown ESC/POS (generic)");
    expect(dev.capabilities.protocol).toBe("escpos");
    // Generic assumes no cutter / no drawer port.
    expect(dev.capabilities.hasCutter).toBe(false);
    expect(dev.capabilities.hasDrawerKick).toBe(false);
  });

  it("never returns undefined", () => {
    expect(identifyDevice(0, 0)).toBeDefined();
  });
});

describe("defaultCapabilities", () => {
  it("epson/star default to ESC/POS 80mm with a cutter + drawer kick", () => {
    for (const brand of ["epson", "star"] as const) {
      const caps = defaultCapabilities(brand);
      expect(caps.paperWidthMm).toBe(80);
      expect(caps.protocol).toBe("escpos");
      expect(caps.hasCutter).toBe(true);
      expect(caps.hasDrawerKick).toBe(true);
    }
  });

  it("generic defaults to a bare ESC/POS printer (no cutter/drawer)", () => {
    const caps = defaultCapabilities("generic");
    expect(caps.hasCutter).toBe(false);
    expect(caps.hasDrawerKick).toBe(false);
  });
});

describe("registry helpers", () => {
  it("isKnownDevice reflects the table", () => {
    expect(isKnownDevice(0x04b8, 0x0202)).toBe(true);
    expect(isKnownDevice(0x04b8, 0xdead)).toBe(false);
  });

  it("listKnownDevices returns all tabled models", () => {
    const all = listKnownDevices();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.some((d) => d.brand === "epson")).toBe(true);
    expect(all.some((d) => d.brand === "star")).toBe(true);
  });

  it("genericEscPosDevice tags a recognised vendor by brand", () => {
    expect(genericEscPosDevice(0x0519, 0x4242).brand).toBe("star");
  });
});
