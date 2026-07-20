import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINTER_CONFIG,
  isPrinterReady,
  parsePrinterConfig,
  type PrinterConfig,
} from "./printer-config";

describe("parsePrinterConfig", () => {
  it("round-trips a valid config", () => {
    const cfg: PrinterConfig = {
      enabled: true,
      kind: "tcp",
      address: "192.168.1.50:9100",
      openDrawer: false,
      paperWidth: 58,
    };
    expect(parsePrinterConfig(cfg)).toEqual(cfg);
  });

  it("fills defaults for a partial object", () => {
    expect(
      parsePrinterConfig({ enabled: true, address: "MyPrinter", kind: "windows_spooler" }),
    ).toEqual({
      enabled: true,
      kind: "windows_spooler",
      address: "MyPrinter",
      openDrawer: true,
      paperWidth: 80,
    });
  });

  it("falls back to the default config on malformed input", () => {
    expect(parsePrinterConfig(null)).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(parsePrinterConfig("nonsense")).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(parsePrinterConfig({ kind: "smoke-signals" })).toEqual(DEFAULT_PRINTER_CONFIG);
    expect(parsePrinterConfig({ paperWidth: 76 })).toEqual(DEFAULT_PRINTER_CONFIG);
  });
});

describe("isPrinterReady", () => {
  it("is true only when enabled with a non-blank address", () => {
    expect(isPrinterReady({ ...DEFAULT_PRINTER_CONFIG, enabled: true, address: "10.0.0.9" })).toBe(
      true,
    );
    expect(isPrinterReady({ ...DEFAULT_PRINTER_CONFIG, enabled: false, address: "10.0.0.9" })).toBe(
      false,
    );
    expect(isPrinterReady({ ...DEFAULT_PRINTER_CONFIG, enabled: true, address: "   " })).toBe(
      false,
    );
    expect(isPrinterReady(DEFAULT_PRINTER_CONFIG)).toBe(false);
  });
});
