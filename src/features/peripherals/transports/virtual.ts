/**
 * Peripherals — VIRTUAL TRANSPORT (a hardware-free test/preview harness).
 *
 * This is the FIRST concrete implementation of the `PeripheralProvider` /
 * `PeripheralDevice` type contracts from `../types.ts`, but it touches NO
 * hardware: instead of forwarding ESC/POS bytes to `navigator.usb` / Bluetooth /
 * a network printer, it CAPTURES every byte stream into an in-memory buffer and
 * counts drawer kicks. That makes the whole peripherals stack exercisable in
 * unit tests — and gives the app a real "print preview" feed: capture the same
 * bytes `formatReceipt()` would send to metal, then render them on screen with
 * `../preview.ts`.
 *
 * Pure + deterministic: no DOM, no network, no timers, no `navigator.*`. Every
 * promise resolves synchronously-in-spirit (microtask only) so tests need no
 * fake clock.
 */

import { identifyDevice } from "../registry";
import type {
  DeviceCapabilities,
  DeviceStatus,
  DeviceTarget,
  KnownDevice,
  PeripheralDevice,
  PeripheralKind,
  PeripheralProvider,
  Transport,
} from "../types";

/** A single captured event on the virtual device, in submission order. */
export type VirtualEvent =
  | { type: "print"; bytes: Uint8Array }
  | { type: "drawerKick" };

/**
 * The shared in-memory capture log. A `VirtualDevice` writes to it; tests and the
 * preview UI read from it. Kept as its own object so a caller can inspect the log
 * even after `disconnect()` releases the device.
 */
export class VirtualCapture {
  /** Every event (print / drawerKick) in the order it was submitted. */
  readonly events: VirtualEvent[] = [];

  /** Record a print job. The bytes are copied so later mutation can't corrupt the log. */
  recordPrint(bytes: Uint8Array): void {
    this.events.push({ type: "print", bytes: bytes.slice() });
  }

  /** Record a cash-drawer kick. */
  recordDrawerKick(): void {
    this.events.push({ type: "drawerKick" });
  }

  /** Every captured print job's bytes, in order. */
  get printJobs(): Uint8Array[] {
    return this.events.flatMap((e) => (e.type === "print" ? [e.bytes] : []));
  }

  /** All printed bytes concatenated into one stream (what a printer would have received). */
  get bytes(): Uint8Array {
    const jobs = this.printJobs;
    let length = 0;
    for (const j of jobs) length += j.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const j of jobs) {
      out.set(j, offset);
      offset += j.length;
    }
    return out;
  }

  /** Count of `print()` calls captured. */
  get printCount(): number {
    return this.events.reduce((n, e) => n + (e.type === "print" ? 1 : 0), 0);
  }

  /** Count of cash-drawer kicks captured (standalone + via print options). */
  get drawerKickCount(): number {
    return this.events.reduce((n, e) => n + (e.type === "drawerKick" ? 1 : 0), 0);
  }

  /** Clear the log (e.g. between two preview renders). */
  reset(): void {
    this.events.length = 0;
  }
}

const DEFAULT_USB = { vendorId: 0x04b8, productId: 0x0202 }; // an Epson TM-T88-class default

/**
 * A connected virtual device. Implements the full `PeripheralDevice` contract;
 * `print()` / `kickDrawer()` append to the capture log instead of doing I/O.
 */
export class VirtualDevice implements PeripheralDevice {
  readonly kind: PeripheralKind;
  readonly transport: Transport;
  readonly capabilities: DeviceCapabilities;
  readonly identity: KnownDevice;
  /** The capture log this device writes to (shared with the provider/tests). */
  readonly capture: VirtualCapture;

  private connected = true;

  constructor(args: {
    kind: PeripheralKind;
    transport: Transport;
    identity: KnownDevice;
    capture: VirtualCapture;
  }) {
    this.kind = args.kind;
    this.transport = args.transport;
    this.identity = args.identity;
    this.capabilities = args.identity.capabilities;
    this.capture = args.capture;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async status(): Promise<DeviceStatus> {
    return this.connected ? "ready" : "disconnected";
  }

  async print(bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("VirtualDevice: print after disconnect");
    this.capture.recordPrint(bytes);
  }

  async kickDrawer(): Promise<void> {
    if (!this.connected) throw new Error("VirtualDevice: kickDrawer after disconnect");
    this.capture.recordDrawerKick();
  }
}

/**
 * A `PeripheralProvider` that hands out `VirtualDevice`s. One provider owns one
 * `VirtualCapture` shared across every device it connects, so a test can read all
 * captured bytes from `provider.capture` regardless of which device produced them.
 */
export class VirtualTransport implements PeripheralProvider {
  readonly id = "virtual";
  readonly transport: Transport = "local_bridge";
  readonly supportedKinds: readonly PeripheralKind[] = [
    "printer",
    "cash_drawer",
    "barcode_scanner",
  ];

  /** The shared capture log for everything this provider connects. */
  readonly capture = new VirtualCapture();

  async connect(target: DeviceTarget): Promise<VirtualDevice> {
    const usb = target.usb ?? DEFAULT_USB;
    const identity = identifyDevice(usb.vendorId, usb.productId);
    return new VirtualDevice({
      kind: target.kind,
      // Report back the transport the caller asked for, so the device looks like
      // whatever rail it stands in for (defaults to this provider's transport).
      transport: target.transport ?? this.transport,
      identity,
      capture: this.capture,
    });
  }
}
