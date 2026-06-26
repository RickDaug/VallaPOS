/**
 * Peripherals groundwork — DEVICE MANAGER (pure selector/orchestration shell).
 *
 * ⚠ INERT SCAFFOLD. Pure orchestration logic ONLY — transport selection, device
 * de-duplication, and capability queries over a set of discovered devices. There
 * are NO `navigator.usb` / Web Bluetooth / Web Serial calls here; opening real
 * connections is a Phase-1 transport-adapter concern, out of scope for this PR.
 * Everything below is synchronous, deterministic, and unit-testable.
 *
 * Mirrors the inert payments registry/selector shape.
 */

import { identifyDevice } from "./registry";
import type {
  DeviceCapabilities,
  KnownDevice,
  PeripheralKind,
  Transport,
  UsbDeviceId,
} from "./types";

/** A device the manager has seen, with its resolved identity + transport. */
export interface DiscoveredDevice {
  /** USB identity when discovered over a USB-class transport. */
  usb?: UsbDeviceId;
  /** Network endpoint when discovered over a network transport. */
  endpoint?: string;
  transport: Transport;
  identity: KnownDevice;
}

/**
 * Transports that can run in the browser PWA today (user-gesture permission
 * gated, but no native shell needed). Network transports reach hardware over the
 * LAN; the browser-native ones need the corresponding Web* API.
 */
const WEB_CAPABLE_TRANSPORTS: readonly Transport[] = [
  "webusb",
  "web_bluetooth",
  "web_serial",
  "network_epos",
  "network_cloudprnt",
  // `local_bridge` needs a helper process running on the machine, so it's not
  // "web-only" in the same sense; left out of the pure web-capable set.
];

/** True if a transport can be driven from the browser PWA (no native shell). */
export function isWebCapableTransport(transport: Transport): boolean {
  return WEB_CAPABLE_TRANSPORTS.includes(transport);
}

/**
 * Preference order when a device could be reached over multiple transports.
 * Lower index = more preferred. Direct USB is the most reliable for a wired
 * receipt printer; the network rails come next; the local bridge is last (needs
 * extra software). Unknown transports sort last.
 */
const TRANSPORT_PREFERENCE: readonly Transport[] = [
  "webusb",
  "web_serial",
  "network_epos",
  "network_cloudprnt",
  "web_bluetooth",
  "local_bridge",
];

function transportRank(transport: Transport): number {
  const i = TRANSPORT_PREFERENCE.indexOf(transport);
  return i === -1 ? TRANSPORT_PREFERENCE.length : i;
}

/**
 * Pick the best transport for a device from the set it's reachable on. Returns
 * the most-preferred available transport, or undefined when the candidate set is
 * empty. Pure ranking — performs no I/O.
 */
export function pickTransport(available: readonly Transport[]): Transport | undefined {
  if (available.length === 0) return undefined;
  return [...available].sort((a, b) => transportRank(a) - transportRank(b))[0];
}

/** Stable de-dupe key for a discovered device. */
function deviceKey(d: DiscoveredDevice): string {
  if (d.usb) {
    return `usb:${d.usb.vendorId.toString(16)}:${d.usb.productId.toString(16)}`;
  }
  if (d.endpoint) return `net:${d.transport}:${d.endpoint}`;
  return `${d.transport}:${d.identity.brand}:${d.identity.model}`;
}

/**
 * De-duplicate a list of discovered devices (e.g. the same printer enumerated
 * twice across a re-scan). First occurrence wins; order is otherwise preserved.
 * Pure.
 */
export function dedupeDevices(devices: readonly DiscoveredDevice[]): DiscoveredDevice[] {
  const seen = new Set<string>();
  const out: DiscoveredDevice[] = [];
  for (const d of devices) {
    const k = deviceKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/**
 * Build a `DiscoveredDevice` for a USB device from its ids, resolving identity
 * through the registry. Pure — does not open the device.
 */
export function describeUsbDevice(
  usb: UsbDeviceId,
  transport: Transport = "webusb",
): DiscoveredDevice {
  return {
    usb,
    transport,
    identity: identifyDevice(usb.vendorId, usb.productId),
  };
}

/** Filter discovered devices down to a single peripheral kind. */
export function devicesOfKind(
  devices: readonly DiscoveredDevice[],
  kind: PeripheralKind,
): DiscoveredDevice[] {
  return devices.filter((d) => d.identity.kind === kind);
}

/**
 * The first printer that can fire a cash-drawer kick, if any. Used to decide
 * whether the "open drawer" action is available without a standalone drawer.
 */
export function findDrawerKicker(
  devices: readonly DiscoveredDevice[],
): DiscoveredDevice | undefined {
  return devices.find(
    (d) => d.identity.kind === "printer" && d.identity.capabilities.hasDrawerKick,
  );
}

/** Capabilities of a discovered device (convenience accessor). */
export function capabilitiesOf(device: DiscoveredDevice): DeviceCapabilities {
  return device.identity.capabilities;
}
