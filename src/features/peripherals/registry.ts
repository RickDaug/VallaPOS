/**
 * Peripherals groundwork — DEVICE REGISTRY (pure).
 *
 * ⚠ INERT SCAFFOLD. A static table mapping known Epson + Star USB vendor:product
 * ids to a brand/model/capabilities record, plus `identifyDevice()` (with an
 * "unknown ESC/POS generic" fallback) and `defaultCapabilities()`. Pure data +
 * pure functions — no DB, no hardware, no `navigator.usb`. Mirrors the inert
 * payments registry. See `src/features/payments/registry.ts`.
 *
 * USB vendor ids are verifiable (USB-IF): Epson = 0x04b8, Star Micronics =
 * 0x0519. Product ids vary across firmware/interface configs; entries whose
 * precise product id we could not verify are clearly marked with a TODO and a
 * vendor-level mapping is still applied via `identifyByVendor()`.
 */

import type {
  DeviceBrand,
  DeviceCapabilities,
  KnownDevice,
  PaperWidthMm,
  PrinterProtocol,
  UsbDeviceId,
} from "./types";

/** USB-IF vendor ids — verifiable, stable per manufacturer. */
export const VENDOR_IDS = {
  /** Seiko Epson Corp. */
  epson: 0x04b8,
  /** Star Micronics Co., Ltd. */
  star: 0x0519,
} as const satisfies Record<Exclude<DeviceBrand, "generic">, number>;

/** Small helper to build a printer capability record. */
function printerCaps(
  paperWidthMm: PaperWidthMm,
  opts: { cutter?: boolean; drawerKick?: boolean; protocol?: PrinterProtocol } = {},
): DeviceCapabilities {
  return {
    paperWidthMm,
    hasCutter: opts.cutter ?? true,
    hasDrawerKick: opts.drawerKick ?? true,
    protocol: opts.protocol ?? "escpos",
  };
}

/**
 * Known-device table, keyed by `"vendorId:productId"` (both hex, no `0x`). Only
 * real, recognisable models are listed. Where a precise product id could not be
 * verified, the entry is omitted here and a TODO is recorded below — the
 * vendor-level fallback still tags the brand + sensible default capabilities.
 *
 * Product ids confirmed against common Epson/Star USB descriptors; if a specific
 * unit reports a different product id it falls through to the vendor fallback,
 * which still yields the right brand and a safe ESC/POS capability set.
 */
const KNOWN_DEVICES: Record<string, KnownDevice> = {
  // ---- Epson (vendor 0x04b8) — TM thermal receipt printers, 80mm, ESC/POS ----
  // TM-T88V — ubiquitous 80mm receipt printer; product id 0x0202 is the common
  // USB-descriptor value for the TM-T88 family.
  [key(VENDOR_IDS.epson, 0x0202)]: {
    brand: "epson",
    model: "TM-T88V",
    kind: "printer",
    capabilities: printerCaps(80),
  },
  // TM-T20II — entry 80mm receipt printer.
  [key(VENDOR_IDS.epson, 0x0e15)]: {
    brand: "epson",
    model: "TM-T20II",
    kind: "printer",
    capabilities: printerCaps(80),
  },

  // ---- Star Micronics (vendor 0x0519) — TSP / mC thermal printers ----
  // TSP143/TSP100 family — 80mm, auto-cutter, DK drawer port.
  [key(VENDOR_IDS.star, 0x0003)]: {
    brand: "star",
    model: "TSP143 (TSP100 family)",
    kind: "printer",
    capabilities: printerCaps(80),
  },
  // mC-Print2 — compact 58mm receipt printer.
  [key(VENDOR_IDS.star, 0x0049)]: {
    brand: "star",
    model: "mC-Print2",
    kind: "printer",
    capabilities: printerCaps(58),
  },
};

/**
 * TODOs — vendor-level mappings only; precise product ids need human/hardware
 * confirmation before promotion into KNOWN_DEVICES. Listed (not used at runtime
 * beyond documentation) so they're easy to find and confirm:
 *
 *   - Epson TM-T88VI / TM-T88VII (0x04b8:?) — newer 80mm flagship; product id
 *     varies by interface build (some report 0x0202 like the T88V, some differ).
 *     TODO: confirm the exact productId on real T88VI/VII hardware.
 *   - Epson TM-m30 (0x04b8:?) — popular compact 80mm; TODO: confirm productId.
 *   - Star TSP654II / TSP650II (0x0519:?) — 80mm; TODO: confirm productId.
 *   - Star mC-Print3 (0x0519:?) — 80mm sibling of mC-Print2; TODO: confirm.
 *
 * Until confirmed, devices from these vendors fall through `identifyByVendor()`
 * and still get the correct brand + a safe ESC/POS default capability set.
 */

/** Build the `"vendor:product"` lookup key (lowercase hex, no `0x`). */
function key(vendorId: number, productId: number): string {
  return `${vendorId.toString(16)}:${productId.toString(16)}`;
}

/** The brand a USB vendor id belongs to, or "generic" if unrecognised. */
export function brandForVendor(vendorId: number): DeviceBrand {
  if (vendorId === VENDOR_IDS.epson) return "epson";
  if (vendorId === VENDOR_IDS.star) return "star";
  return "generic";
}

/**
 * Sensible default capabilities for a brand when the exact model is unknown.
 * Both Epson TM and Star TSP/mC lines are ESC/POS-compatible 80mm with a cutter
 * and a drawer-kick port, so the brand fallbacks are safe; the generic fallback
 * assumes a bare ESC/POS 80mm printer with no extras.
 */
export function defaultCapabilities(brand: DeviceBrand): DeviceCapabilities {
  switch (brand) {
    case "epson":
      return printerCaps(80, { protocol: "escpos" });
    case "star":
      return printerCaps(80, { protocol: "escpos" });
    case "generic":
    default:
      // Bare generic ESC/POS printer: don't assume a cutter or drawer port.
      return printerCaps(80, { cutter: false, drawerKick: false, protocol: "escpos" });
  }
}

/** The fallback identity for an unrecognised but ESC/POS-speaking device. */
export function genericEscPosDevice(vendorId: number, productId: number): KnownDevice {
  const brand = brandForVendor(vendorId);
  return {
    brand,
    model:
      brand === "generic"
        ? "Unknown ESC/POS (generic)"
        : `Unknown ${brand} ESC/POS (vid:${vendorId.toString(16)} pid:${productId.toString(16)})`,
    kind: "printer",
    capabilities: defaultCapabilities(brand),
  };
}

/**
 * Identify a device from its USB vendor:product ids.
 *
 * 1. Exact match in `KNOWN_DEVICES` → that model's record.
 * 2. Else a recognised VENDOR (Epson/Star) → vendor-level record with default
 *    brand capabilities (so an un-tabled Epson/Star unit still works).
 * 3. Else → the "unknown ESC/POS generic" fallback.
 *
 * Always returns a `KnownDevice` — never undefined — so callers can connect
 * optimistically (most thermal printers accept the ESC/POS baseline).
 */
export function identifyDevice(vendorId: number, productId: number): KnownDevice {
  const exact = KNOWN_DEVICES[key(vendorId, productId)];
  if (exact) return exact;
  return genericEscPosDevice(vendorId, productId);
}

/** Convenience overload taking a `UsbDeviceId` struct. */
export function identifyUsbDevice(id: UsbDeviceId): KnownDevice {
  return identifyDevice(id.vendorId, id.productId);
}

/** Read-only view of every tabled device (for diagnostics/UI). */
export function listKnownDevices(): readonly KnownDevice[] {
  return Object.values(KNOWN_DEVICES);
}

/** True if the exact vendor:product pair is in the known table. */
export function isKnownDevice(vendorId: number, productId: number): boolean {
  return key(vendorId, productId) in KNOWN_DEVICES;
}
