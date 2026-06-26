/**
 * Peripherals groundwork — PURE TYPES.
 *
 * ⚠ INERT SCAFFOLD. Nothing in `src/features/peripherals/` is wired into the live
 * app yet. This is the device-manager abstraction + device registry for
 * peripheral hardware (receipt printers, cash drawers, barcode scanners),
 * mirroring the inert `src/features/payments/*` provider/registry/flags pattern.
 *
 * Real transport adapters (WebUSB / Web Bluetooth / Web Serial / network ePOS)
 * are deliberately DEFERRED to a Phase-1 implementation PR. NOTHING here touches
 * `navigator.usb`, Bluetooth, the DOM, or any real hardware — the interfaces
 * below are TYPE CONTRACTS only, so the registry/selector logic stays pure and
 * unit-testable without dragging browser globals into the bundle.
 *
 * The byte-level ESC/POS command builder lives in a separate `escpos.ts`
 * (owned elsewhere) and is intentionally not imported here.
 */

/** A class of peripheral hardware the POS can talk to. */
export type PeripheralKind = "printer" | "cash_drawer" | "barcode_scanner";

/**
 * How bytes get to/from a device. Browser-native transports require user-gesture
 * permission grants (WebUSB / Web Bluetooth / Web Serial); the network/bridge
 * transports go over the LAN or a local helper process instead.
 */
export type Transport =
  | "webusb" // WebUSB — USB printers/drawers via navigator.usb
  | "web_bluetooth" // Web Bluetooth — BLE mobile printers
  | "web_serial" // Web Serial — serial/RS-232 over USB adapters
  | "network_epos" // Epson ePOS-Device / ePOS-Print over the LAN (HTTP/XML)
  | "network_cloudprnt" // Star CloudPRNT (printer polls a server URL)
  | "local_bridge"; // a local helper process (e.g. WebSocket bridge to OS drivers)

/** Wire protocol a printer speaks. */
export type PrinterProtocol = "escpos" | "epos" | "webprnt";

/** Receipt paper width, in millimetres. The two near-universal thermal widths. */
export type PaperWidthMm = 58 | 80;

/**
 * Static description of what a concrete device can do. Used by the registry to
 * answer "can this device cut paper / kick a drawer?" without probing hardware.
 */
export interface DeviceCapabilities {
  /** Thermal paper width — drives the character-per-line + raster width math. */
  paperWidthMm: PaperWidthMm;
  /** Has an auto-cutter (partial/full cut) vs tear-bar only. */
  hasCutter: boolean;
  /** Can fire a cash-drawer kick (DK port) — printer-driven drawers. */
  hasDrawerKick: boolean;
  /** Command protocol the device understands. */
  protocol: PrinterProtocol;
}

/** Connection state of a device, transport-agnostic. */
export type DeviceStatus =
  | "disconnected" // not connected / permission not yet granted
  | "connecting" // handshake in progress
  | "ready" // connected and idle, can accept jobs
  | "busy" // a job is in flight
  | "error"; // last operation failed / device fault (e.g. out of paper)

/**
 * Identity of a USB device, as reported by the descriptor. Both ids are 16-bit
 * unsigned integers (the same values `USBDevice.vendorId`/`productId` return).
 */
export interface UsbDeviceId {
  /** USB-IF vendor id, e.g. 0x04b8 (Epson), 0x0519 (Star Micronics). */
  vendorId: number;
  /** Vendor-assigned product id. */
  productId: number;
}

/** A device the registry knows about, resolved from its USB ids. */
export interface KnownDevice {
  brand: DeviceBrand;
  /** Human-readable model, e.g. "TM-T88VI", "TSP143III". */
  model: string;
  kind: PeripheralKind;
  capabilities: DeviceCapabilities;
}

/** Manufacturers we ship registry entries for. */
export type DeviceBrand = "epson" | "star" | "generic";

/**
 * A `PeripheralProvider` is the uniform surface for a TRANSPORT (e.g. a WebUSB
 * provider, a network ePOS provider). It opens connections to devices that speak
 * over that transport. CONTRACT ONLY — no concrete provider lives in this PR.
 */
export interface PeripheralProvider {
  /** Stable provider key, e.g. "webusb", "network-epos". */
  readonly id: string;
  /** The transport this provider drives. */
  readonly transport: Transport;
  /** Kinds of device this provider can connect to. */
  readonly supportedKinds: readonly PeripheralKind[];

  /**
   * Open a connection to a device. In Phase 1 the concrete provider performs the
   * real transport handshake (e.g. `navigator.usb.requestDevice`); here it is a
   * type contract only.
   */
  connect(target: DeviceTarget): Promise<PeripheralDevice>;
}

/** What identifies a device to connect to (transport-specific selector). */
export interface DeviceTarget {
  kind: PeripheralKind;
  transport: Transport;
  /** USB ids when the transport is `webusb` (used to identify the model). */
  usb?: UsbDeviceId;
  /** Network endpoint when the transport is `network_epos`/`network_cloudprnt`. */
  endpoint?: string;
}

/**
 * A `PeripheralDevice` is a connected, addressable piece of hardware. CONTRACT
 * ONLY — every method is a typed promise the Phase-1 transport adapters will
 * implement. None of these run in this PR (no real I/O).
 */
export interface PeripheralDevice {
  readonly kind: PeripheralKind;
  readonly transport: Transport;
  readonly capabilities: DeviceCapabilities;
  /** The resolved registry identity, when the device was recognised. */
  readonly identity: KnownDevice;

  /** Close the connection / release the transport handle. */
  disconnect(): Promise<void>;

  /** Current connection state. Cheap, does not perform I/O in the contract. */
  status(): Promise<DeviceStatus>;

  /**
   * Send raw bytes to a printer (e.g. an ESC/POS command stream built elsewhere).
   * The device manager NEVER builds these bytes — it forwards an opaque buffer.
   */
  print(bytes: Uint8Array): Promise<void>;

  /**
   * Fire the cash-drawer kick. Only meaningful when `capabilities.hasDrawerKick`
   * (printer-driven drawer) or the device is itself a `cash_drawer`.
   */
  kickDrawer(): Promise<void>;
}
