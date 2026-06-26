/**
 * Peripherals — WebUSB transport adapter (Phase 1).
 *
 * The first REAL transport for the `src/features/peripherals/*` groundwork: it
 * drives an Epson/Star thermal printer (and its RJ11-kicked cash drawer) directly
 * from the browser over `navigator.usb` (WebUSB). It implements the existing
 * `PeripheralProvider` / `PeripheralDevice` type contracts from `./types` and uses
 * `identifyDevice()` + `VENDOR_IDS` from `../registry` to recognise the unit.
 *
 * Target runtimes: **desktop Chrome + Android Chrome** (NOT iOS/Safari — Safari
 * ships no WebUSB at all). On **Android** WebUSB claims the printer interface
 * cleanly. On **Windows** the OS auto-installs `usbprint.sys`, which claims the
 * USB interface exclusively, so `device.open()`/`claimInterface()` throws a
 * misleadingly-named `Access denied` until the driver is swapped to **WinUSB**
 * (e.g. via Zadig). That is a provisioning step, not a bug in this code — see
 * `docs/PERIPHERALS.md` §1 "Windows device-claimed-by-the-OS-driver gotcha".
 *
 * ── SSR / build / testability ──────────────────────────────────────────────
 * This module is import-safe in a server/SSR/build context: it NEVER touches
 * `navigator.usb` at module top-level. Every access is guarded
 * (`typeof navigator !== "undefined" && navigator.usb`), and the `usb` object is
 * **injectable** (constructor parameter, defaulting to the real `navigator.usb`)
 * so tests pass a fake. Where WebUSB is unsupported the methods throw a clear,
 * typed `WebUsbUnsupportedError` (or no-op, where a no-op is the safe choice).
 *
 * NOTE: the TS DOM lib does not (reliably) ship the WebUSB types, so we declare
 * the minimal local interfaces we actually use below — no new dependency.
 */

import { identifyDevice, VENDOR_IDS } from "../registry";
import type {
  DeviceCapabilities,
  DeviceStatus,
  KnownDevice,
  PeripheralDevice,
  PeripheralKind,
  PeripheralProvider,
  Transport,
  UsbDeviceId,
} from "../types";
import { drawerKick as buildDrawerKick } from "../escpos";

// ---------------------------------------------------------------------------
// Minimal local WebUSB type surface (the DOM lib may omit these).
// Only the members this adapter actually uses are declared.
// ---------------------------------------------------------------------------

/** A single USB endpoint inside an alternate interface. */
export interface UsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous" | "control";
}

/** A USB alternate-interface setting (carries the endpoints). */
export interface UsbAlternateInterfaceLike {
  alternateSetting: number;
  endpoints: UsbEndpointLike[];
}

/** A claimable USB interface. */
export interface UsbInterfaceLike {
  interfaceNumber: number;
  claimed: boolean;
  alternate: UsbAlternateInterfaceLike;
  alternates: UsbAlternateInterfaceLike[];
}

/** A selectable USB configuration. */
export interface UsbConfigurationLike {
  configurationValue: number;
  interfaces: UsbInterfaceLike[];
}

/** Result of an OUT transfer. */
export interface UsbOutTransferResultLike {
  bytesWritten: number;
  status: "ok" | "stall" | "babble";
}

/** The subset of `USBDevice` we drive. */
export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly serialNumber?: string;
  readonly opened: boolean;
  readonly configuration: UsbConfigurationLike | null;
  readonly configurations: UsbConfigurationLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(
    interfaceNumber: number,
    alternateSetting: number,
  ): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<UsbOutTransferResultLike>;
}

/** A USB vendor/product filter for the device picker. */
export interface UsbDeviceFilterLike {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}

export interface UsbRequestDeviceOptionsLike {
  filters: UsbDeviceFilterLike[];
}

/** The connect/disconnect event shape `navigator.usb` fires. */
export interface UsbConnectionEventLike {
  device: UsbDeviceLike;
}

/** The subset of `navigator.usb` (the `USB` interface) this adapter uses. */
export interface UsbLike {
  requestDevice(options: UsbRequestDeviceOptionsLike): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: UsbConnectionEventLike) => void,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: UsbConnectionEventLike) => void,
  ): void;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/** Thrown when WebUSB is unavailable in the current runtime (SSR, iOS/Safari). */
export class WebUsbUnsupportedError extends Error {
  constructor(message = "WebUSB is not available in this environment") {
    super(message);
    this.name = "WebUsbUnsupportedError";
  }
}

/** Thrown when no usable bulk-OUT endpoint/interface can be found on a device. */
export class WebUsbNoEndpointError extends Error {
  constructor(message = "No bulk-OUT endpoint found on the USB device") {
    super(message);
    this.name = "WebUsbNoEndpointError";
  }
}

// ---------------------------------------------------------------------------
// Resolving the default `navigator.usb` — guarded, never at module top-level.
// ---------------------------------------------------------------------------

/**
 * Resolve the real `navigator.usb`, or `undefined` if unavailable. Guards every
 * access so this is safe to call on the server / during build / on iOS Safari.
 */
export function resolveNavigatorUsb(): UsbLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const usb = (navigator as unknown as { usb?: UsbLike }).usb;
  return usb ?? undefined;
}

/** True when WebUSB is usable right now (a `navigator.usb` exists). */
export function isWebUsbSupported(usb: UsbLike | undefined = resolveNavigatorUsb()): boolean {
  return usb != null;
}

// ---------------------------------------------------------------------------
// Endpoint discovery (pure — exported for tests).
// ---------------------------------------------------------------------------

/** A located printer interface + its bulk-OUT endpoint. */
export interface BulkOutTarget {
  interfaceNumber: number;
  alternateSetting: number;
  endpointNumber: number;
}

/**
 * Find the first claimable interface that exposes a **bulk OUT** endpoint — the
 * standard way a receipt printer accepts a raw ESC/POS byte stream. Returns the
 * interface number, its alternate setting, and the OUT endpoint number. Pure.
 */
export function findBulkOutEndpoint(
  configuration: UsbConfigurationLike | null,
): BulkOutTarget | undefined {
  if (!configuration) return undefined;
  for (const iface of configuration.interfaces) {
    // Prefer the active alternate, but scan all alternates as a fallback.
    const alternates = iface.alternates?.length ? iface.alternates : [iface.alternate];
    for (const alt of alternates) {
      const out = alt.endpoints.find(
        (e) => e.direction === "out" && e.type === "bulk",
      );
      if (out) {
        return {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          endpointNumber: out.endpointNumber,
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The connected-device handle (implements PeripheralDevice).
// ---------------------------------------------------------------------------

/** Default chunk size for `transferOut`. WebUSB handles large buffers, but
 * chunking keeps per-transfer payloads modest and lets slow printers drain. */
const DEFAULT_CHUNK_BYTES = 4096;

/**
 * A connected WebUSB printer/drawer. Implements the `PeripheralDevice` contract:
 * `print(bytes)` chunks the stream to the bulk-OUT endpoint, `kickDrawer()` sends
 * the ESC/POS drawer-kick bytes, `disconnect()` releases the interface + closes.
 */
export class WebUsbDevice implements PeripheralDevice {
  readonly kind: PeripheralKind;
  readonly transport: Transport = "webusb";
  readonly capabilities: DeviceCapabilities;
  readonly identity: KnownDevice;

  private readonly device: UsbDeviceLike;
  private readonly target: BulkOutTarget;
  private readonly chunkBytes: number;
  private state: DeviceStatus = "ready";
  private closed = false;

  constructor(
    device: UsbDeviceLike,
    target: BulkOutTarget,
    identity: KnownDevice,
    opts: { chunkBytes?: number } = {},
  ) {
    this.device = device;
    this.target = target;
    this.identity = identity;
    this.kind = identity.kind;
    this.capabilities = identity.capabilities;
    this.chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  }

  /** The underlying USB device (for the transport's reconnect bookkeeping). */
  get usbDevice(): UsbDeviceLike {
    return this.device;
  }

  async status(): Promise<DeviceStatus> {
    if (this.closed || !this.device.opened) return "disconnected";
    return this.state;
  }

  /** Chunked `transferOut` of a raw byte stream to the bulk-OUT endpoint. */
  async print(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new WebUsbUnsupportedError("Device is disconnected");
    this.state = "busy";
    try {
      for (let offset = 0; offset < bytes.length; offset += this.chunkBytes) {
        const chunk = bytes.subarray(offset, offset + this.chunkBytes);
        // `transferOut` needs a standalone buffer; copy the subarray view.
        await this.device.transferOut(this.target.endpointNumber, chunk.slice());
      }
      // An empty stream still counts as a successful (no-op) print.
      this.state = "ready";
    } catch (err) {
      this.state = "error";
      throw err;
    }
  }

  /** Fire the cash-drawer kick (ESC p pulse) over the printer's OUT endpoint. */
  async kickDrawer(): Promise<void> {
    // Reuses the pure ESC/POS drawer-kick builder so the bytes match escpos.ts.
    await this.print(buildDrawerKick());
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state = "disconnected";
    try {
      if (this.device.opened) {
        await this.device.releaseInterface(this.target.interfaceNumber);
      }
    } catch {
      // Releasing can fail if the device was already pulled — ignore.
    }
    try {
      if (this.device.opened) await this.device.close();
    } catch {
      // Closing a yanked device throws — ignore; the handle is dead either way.
    }
  }
}

// ---------------------------------------------------------------------------
// The transport (implements PeripheralProvider).
// ---------------------------------------------------------------------------

/** A previously granted, not-yet-connected device the origin can re-acquire. */
export interface KnownUsbDevice {
  usb: UsbDeviceId;
  identity: KnownDevice;
  /** The live `USBDevice` handle (pass to `connectDevice` to open it). */
  device: UsbDeviceLike;
}

export type WebUsbEvent =
  | { type: "connect"; usb: UsbDeviceId; identity: KnownDevice }
  | { type: "disconnect"; usb: UsbDeviceId; identity: KnownDevice };

export interface WebUsbTransportOptions {
  /** Bytes per `transferOut` chunk for devices opened by this transport. */
  chunkBytes?: number;
}

/**
 * The WebUSB transport adapter. Implements `PeripheralProvider`.
 *
 * Construct with a `usb` object — defaults to the real `navigator.usb`, but tests
 * inject a fake. If WebUSB is unavailable the transport is *constructible* (safe
 * for SSR) but its USB methods throw `WebUsbUnsupportedError`.
 */
export class WebUsbTransport implements PeripheralProvider {
  readonly id = "webusb";
  readonly transport: Transport = "webusb";
  readonly supportedKinds: readonly PeripheralKind[] = ["printer", "cash_drawer"];

  private readonly usb: UsbLike | undefined;
  private readonly chunkBytes: number | undefined;

  /** Registered listeners for connectivity changes (auto-reconnect). */
  private readonly listeners = new Set<(e: WebUsbEvent) => void>();
  private boundConnect?: (e: UsbConnectionEventLike) => void;
  private boundDisconnect?: (e: UsbConnectionEventLike) => void;

  constructor(
    usb: UsbLike | undefined = resolveNavigatorUsb(),
    opts: WebUsbTransportOptions = {},
  ) {
    this.usb = usb;
    this.chunkBytes = opts.chunkBytes;
  }

  /** True when this transport has a usable `navigator.usb`. */
  get isSupported(): boolean {
    return this.usb != null;
  }

  private requireUsb(): UsbLike {
    if (!this.usb) throw new WebUsbUnsupportedError();
    return this.usb;
  }

  /** The vendor filters for the picker — Epson + Star. */
  static deviceFilters(): UsbDeviceFilterLike[] {
    return [{ vendorId: VENDOR_IDS.epson }, { vendorId: VENDOR_IDS.star }];
  }

  /**
   * One-time user-gesture permission step: open the browser's device picker
   * filtered to Epson + Star vendor ids. Returns the granted `USBDevice` (not yet
   * opened). MUST be called from a user gesture (click). Throws
   * `WebUsbUnsupportedError` where WebUSB is unavailable.
   */
  async requestDevice(): Promise<UsbDeviceLike> {
    const usb = this.requireUsb();
    return usb.requestDevice({ filters: WebUsbTransport.deviceFilters() });
  }

  /**
   * Re-acquire already-granted devices with NO picker (for auto-reconnect on app
   * load). Returns each granted device with its resolved registry identity.
   * Returns `[]` (never throws) where WebUSB is unavailable, so callers can treat
   * "no WebUSB" the same as "no granted devices".
   */
  async getKnownDevices(): Promise<KnownUsbDevice[]> {
    if (!this.usb) return [];
    const devices = await this.usb.getDevices();
    return devices.map((device) => ({
      usb: { vendorId: device.vendorId, productId: device.productId },
      identity: identifyDevice(device.vendorId, device.productId),
      device,
    }));
  }

  /**
   * `PeripheralProvider.connect` — open + claim a device by USB id. Resolves the
   * concrete `USBDevice` via `getDevices()` (it must already be granted), then
   * delegates to `connectDevice`. Throws if the device isn't found/granted.
   */
  async connect(target: {
    kind: PeripheralKind;
    transport: Transport;
    usb?: UsbDeviceId;
  }): Promise<PeripheralDevice> {
    if (!target.usb) {
      throw new WebUsbUnsupportedError("WebUSB connect requires a usb {vendorId, productId}");
    }
    const usb = this.requireUsb();
    const devices = await usb.getDevices();
    const match = devices.find(
      (d) => d.vendorId === target.usb!.vendorId && d.productId === target.usb!.productId,
    );
    if (!match) {
      throw new WebUsbUnsupportedError(
        "Device not granted to this origin — call requestDevice() first",
      );
    }
    return this.connectDevice(match);
  }

  /**
   * Open a concrete (already-granted) `USBDevice`: open → selectConfiguration(1)
   * → find the bulk-OUT interface/endpoint → claimInterface → (select alternate)
   * → identify via the registry. Returns a live `WebUsbDevice`.
   *
   * On Windows this is where the `usbprint.sys` driver-claim surfaces as an
   * `Access denied` DOMException from `open()`/`claimInterface()` — see the file
   * header + `docs/PERIPHERALS.md`. The error propagates unchanged so the UI can
   * surface the WinUSB/Zadig remediation.
   */
  async connectDevice(device: UsbDeviceLike): Promise<WebUsbDevice> {
    if (!device.opened) await device.open();

    // Select the first configuration (printers expose a single config = value 1).
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }

    const target = findBulkOutEndpoint(device.configuration);
    if (!target) throw new WebUsbNoEndpointError();

    await device.claimInterface(target.interfaceNumber);
    // Select the matching alternate if the device exposes more than the default.
    if (target.alternateSetting !== 0) {
      await device.selectAlternateInterface(target.interfaceNumber, target.alternateSetting);
    }

    const identity = identifyDevice(device.vendorId, device.productId);
    return new WebUsbDevice(device, target, identity, { chunkBytes: this.chunkBytes });
  }

  /**
   * Subscribe to `navigator.usb` connect/disconnect events for auto-reconnect.
   * Returns an unsubscribe function. No-op (returns a no-op disposer) where
   * WebUSB is unavailable. The first subscription wires the underlying DOM
   * listeners; the last unsubscribe tears them down.
   */
  onConnectivityChange(listener: (e: WebUsbEvent) => void): () => void {
    if (!this.usb) return () => {};
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.attachUsbListeners(this.usb);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detachUsbListeners();
    };
  }

  private attachUsbListeners(usb: UsbLike): void {
    this.boundConnect = (e) => this.emit("connect", e.device);
    this.boundDisconnect = (e) => this.emit("disconnect", e.device);
    usb.addEventListener("connect", this.boundConnect);
    usb.addEventListener("disconnect", this.boundDisconnect);
  }

  private detachUsbListeners(): void {
    if (!this.usb) return;
    if (this.boundConnect) this.usb.removeEventListener("connect", this.boundConnect);
    if (this.boundDisconnect) this.usb.removeEventListener("disconnect", this.boundDisconnect);
    this.boundConnect = undefined;
    this.boundDisconnect = undefined;
  }

  private emit(type: "connect" | "disconnect", device: UsbDeviceLike): void {
    const usb: UsbDeviceId = { vendorId: device.vendorId, productId: device.productId };
    const identity = identifyDevice(device.vendorId, device.productId);
    const event: WebUsbEvent = { type, usb, identity };
    for (const l of this.listeners) l(event);
  }
}
