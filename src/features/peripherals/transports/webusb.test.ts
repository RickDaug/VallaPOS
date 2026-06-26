import { describe, it, expect, vi } from "vitest";
import {
  WebUsbTransport,
  WebUsbDevice,
  WebUsbUnsupportedError,
  WebUsbNoEndpointError,
  findBulkOutEndpoint,
  isWebUsbSupported,
  resolveNavigatorUsb,
  type UsbLike,
  type UsbDeviceLike,
  type UsbConfigurationLike,
  type UsbConnectionEventLike,
  type UsbOutTransferResultLike,
} from "./webusb";
import { VENDOR_IDS } from "../registry";
import { drawerKick as buildDrawerKick } from "../escpos";
import { formatReceipt, type EscPosReceipt } from "../escpos";

// ---------------------------------------------------------------------------
// Fakes — a mock navigator.usb + a mock USBDevice that records every byte.
// Fully hardware-free.
// ---------------------------------------------------------------------------

const OUT_ENDPOINT = 3;

/** Build a single-config, single-interface device with one bulk-OUT endpoint. */
function buildConfiguration(): UsbConfigurationLike {
  const alternate = {
    alternateSetting: 0,
    endpoints: [
      { endpointNumber: 1, direction: "in", type: "bulk" } as const,
      { endpointNumber: OUT_ENDPOINT, direction: "out", type: "bulk" } as const,
    ],
  };
  return {
    configurationValue: 1,
    interfaces: [
      {
        interfaceNumber: 0,
        claimed: false,
        alternate,
        alternates: [alternate],
      },
    ],
  };
}

interface FakeDeviceOptions {
  vendorId?: number;
  productId?: number;
  /** Start with no configuration selected (forces selectConfiguration). */
  noConfiguration?: boolean;
  /** Provide a config with no bulk-OUT endpoint. */
  noBulkOut?: boolean;
}

class FakeUsbDevice implements UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  opened = false;
  configuration: UsbConfigurationLike | null;
  readonly configurations: UsbConfigurationLike[];

  // Recording state for assertions.
  readonly transfers: Uint8Array[] = [];
  readonly claimed: number[] = [];
  readonly released: number[] = [];
  openCount = 0;
  closeCount = 0;
  selectedConfig: number | null = null;
  selectedAlternate: { iface: number; alt: number } | null = null;

  private readonly emptyConfig: UsbConfigurationLike | null;
  private readonly fullConfig: UsbConfigurationLike;

  constructor(opts: FakeDeviceOptions = {}) {
    this.vendorId = opts.vendorId ?? VENDOR_IDS.epson;
    this.productId = opts.productId ?? 0x0202;
    this.fullConfig = opts.noBulkOut
      ? {
          configurationValue: 1,
          interfaces: [
            {
              interfaceNumber: 0,
              claimed: false,
              alternate: { alternateSetting: 0, endpoints: [] },
              alternates: [{ alternateSetting: 0, endpoints: [] }],
            },
          ],
        }
      : buildConfiguration();
    this.configurations = [this.fullConfig];
    this.emptyConfig = opts.noConfiguration ? null : this.fullConfig;
    this.configuration = this.emptyConfig;
  }

  async open(): Promise<void> {
    this.openCount += 1;
    this.opened = true;
  }
  async close(): Promise<void> {
    this.closeCount += 1;
    this.opened = false;
  }
  async selectConfiguration(value: number): Promise<void> {
    this.selectedConfig = value;
    this.configuration = this.fullConfig;
  }
  async claimInterface(n: number): Promise<void> {
    this.claimed.push(n);
  }
  async releaseInterface(n: number): Promise<void> {
    this.released.push(n);
  }
  async selectAlternateInterface(iface: number, alt: number): Promise<void> {
    this.selectedAlternate = { iface, alt };
  }
  async transferOut(endpoint: number, data: BufferSource): Promise<UsbOutTransferResultLike> {
    expect(endpoint).toBe(OUT_ENDPOINT);
    const bytes =
      data instanceof Uint8Array
        ? new Uint8Array(data)
        : new Uint8Array(data as ArrayBuffer);
    this.transfers.push(bytes);
    return { bytesWritten: bytes.length, status: "ok" };
  }

  /** Concatenate every recorded transferOut payload. */
  allBytes(): Uint8Array {
    let len = 0;
    for (const t of this.transfers) len += t.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const t of this.transfers) {
      out.set(t, off);
      off += t.length;
    }
    return out;
  }
}

type Listener = (e: UsbConnectionEventLike) => void;

class FakeUsb implements UsbLike {
  granted: FakeUsbDevice[];
  pickerResult: FakeUsbDevice | null;
  readonly connectListeners = new Set<Listener>();
  readonly disconnectListeners = new Set<Listener>();
  requestCalls = 0;

  constructor(granted: FakeUsbDevice[] = [], pickerResult: FakeUsbDevice | null = null) {
    this.granted = granted;
    this.pickerResult = pickerResult;
  }

  async requestDevice(): Promise<UsbDeviceLike> {
    this.requestCalls += 1;
    if (!this.pickerResult) throw new Error("user cancelled picker");
    if (!this.granted.includes(this.pickerResult)) this.granted.push(this.pickerResult);
    return this.pickerResult;
  }
  async getDevices(): Promise<UsbDeviceLike[]> {
    return this.granted;
  }
  addEventListener(type: "connect" | "disconnect", l: Listener): void {
    (type === "connect" ? this.connectListeners : this.disconnectListeners).add(l);
  }
  removeEventListener(type: "connect" | "disconnect", l: Listener): void {
    (type === "connect" ? this.connectListeners : this.disconnectListeners).delete(l);
  }

  // Test helpers to simulate the browser firing the events.
  fireConnect(device: FakeUsbDevice): void {
    for (const l of this.connectListeners) l({ device });
  }
  fireDisconnect(device: FakeUsbDevice): void {
    for (const l of this.disconnectListeners) l({ device });
  }
}

const sampleReceipt: EscPosReceipt = {
  businessName: "Valla Cafe",
  orderNumber: 7,
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
  ],
  subtotalCents: 1700,
  discountCents: 0,
  taxCents: 140,
  tipCents: 0,
  totalCents: 1840,
  payments: [
    { methodLabel: "Cash", amountCents: 1840, tenderedCents: 2000, changeCents: 160 },
  ],
  qrValue: null,
  footer: "Thank you!",
};

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("findBulkOutEndpoint", () => {
  it("locates the bulk-OUT endpoint + interface", () => {
    const target = findBulkOutEndpoint(buildConfiguration());
    expect(target).toEqual({ interfaceNumber: 0, alternateSetting: 0, endpointNumber: OUT_ENDPOINT });
  });

  it("returns undefined for a null config or one with no bulk-OUT", () => {
    expect(findBulkOutEndpoint(null)).toBeUndefined();
    const noOut: UsbConfigurationLike = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          claimed: false,
          alternate: { alternateSetting: 0, endpoints: [] },
          alternates: [{ alternateSetting: 0, endpoints: [] }],
        },
      ],
    };
    expect(findBulkOutEndpoint(noOut)).toBeUndefined();
  });
});

describe("SSR / unsupported guards", () => {
  it("resolveNavigatorUsb returns undefined when navigator is absent", () => {
    expect(resolveNavigatorUsb()).toBeUndefined();
    expect(isWebUsbSupported(undefined)).toBe(false);
  });

  it("is constructible with no usb (SSR-safe) and reports unsupported", () => {
    const t = new WebUsbTransport(undefined);
    expect(t.isSupported).toBe(false);
  });

  it("throws WebUsbUnsupportedError from requestDevice when unsupported", async () => {
    const t = new WebUsbTransport(undefined);
    await expect(t.requestDevice()).rejects.toBeInstanceOf(WebUsbUnsupportedError);
  });

  it("getKnownDevices returns [] (no throw) when unsupported", async () => {
    const t = new WebUsbTransport(undefined);
    await expect(t.getKnownDevices()).resolves.toEqual([]);
  });

  it("onConnectivityChange is a no-op disposer when unsupported", () => {
    const t = new WebUsbTransport(undefined);
    const off = t.onConnectivityChange(() => {});
    expect(() => off()).not.toThrow();
  });

  it("deviceFilters targets Epson + Star vendor ids", () => {
    expect(WebUsbTransport.deviceFilters()).toEqual([
      { vendorId: VENDOR_IDS.epson },
      { vendorId: VENDOR_IDS.star },
    ]);
  });
});

describe("requestDevice (picker)", () => {
  it("invokes the picker and returns the granted device", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([], dev);
    const t = new WebUsbTransport(usb);
    const result = await t.requestDevice();
    expect(usb.requestCalls).toBe(1);
    expect(result).toBe(dev);
  });
});

describe("connect()", () => {
  it("opens, selects config, claims the interface, and identifies the unit", async () => {
    const dev = new FakeUsbDevice({ noConfiguration: true });
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);

    const device = await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });

    expect(dev.openCount).toBe(1);
    expect(dev.selectedConfig).toBe(1);
    expect(dev.claimed).toEqual([0]);
    expect(device.transport).toBe("webusb");
    expect(device.identity.model).toBe("TM-T88V"); // 0x04b8:0x0202 from the registry
    expect(device.capabilities.hasDrawerKick).toBe(true);
    await expect(device.status()).resolves.toBe("ready");
  });

  it("does not re-select config when one is already active", async () => {
    const dev = new FakeUsbDevice(); // config already present
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });
    expect(dev.selectedConfig).toBeNull();
    expect(dev.claimed).toEqual([0]);
  });

  it("throws when the device is not granted to the origin", async () => {
    const usb = new FakeUsb([]); // nothing granted
    const t = new WebUsbTransport(usb);
    await expect(
      t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: VENDOR_IDS.epson, productId: 0x0202 } }),
    ).rejects.toBeInstanceOf(WebUsbUnsupportedError);
  });

  it("throws WebUsbNoEndpointError when no bulk-OUT endpoint exists", async () => {
    const dev = new FakeUsbDevice({ noBulkOut: true });
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    await expect(
      t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } }),
    ).rejects.toBeInstanceOf(WebUsbNoEndpointError);
  });
});

describe("print()", () => {
  it("sends the exact ESC/POS receipt bytes (concatenated) to the OUT endpoint", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    const device = await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });

    const { bytes } = formatReceipt(sampleReceipt);
    await device.print(bytes);

    expect(dev.allBytes()).toEqual(bytes);
    await expect(device.status()).resolves.toBe("ready");
  });

  it("chunks a large stream across multiple transferOut calls, preserving bytes", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb, { chunkBytes: 8 });
    const device = await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });

    const payload = new Uint8Array(20).map((_, i) => i + 1);
    await device.print(payload);

    expect(dev.transfers.length).toBe(3); // 8 + 8 + 4
    expect(dev.allBytes()).toEqual(payload);
  });

  it("sets status to error and rethrows when transferOut fails", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    const device = await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });
    vi.spyOn(dev, "transferOut").mockRejectedValueOnce(new Error("stall"));
    await expect(device.print(Uint8Array.of(1, 2, 3))).rejects.toThrow("stall");
    await expect(device.status()).resolves.toBe("error");
  });
});

describe("kickDrawer()", () => {
  it("sends exactly the ESC/POS drawer-kick bytes", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    const device = await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } });

    await device.kickDrawer();
    expect(dev.allBytes()).toEqual(buildDrawerKick());
  });
});

describe("getKnownDevices() — auto-reconnect", () => {
  it("returns granted devices with resolved identity and a reusable handle", async () => {
    const epson = new FakeUsbDevice({ vendorId: VENDOR_IDS.epson, productId: 0x0202 });
    const star = new FakeUsbDevice({ vendorId: VENDOR_IDS.star, productId: 0x0003 });
    const usb = new FakeUsb([epson, star]);
    const t = new WebUsbTransport(usb);

    const known = await t.getKnownDevices();
    expect(known.map((k) => k.identity.model)).toEqual(["TM-T88V", "TSP143 (TSP100 family)"]);

    // The handle drives a real reconnect with no picker.
    const starHandle = known[1]!;
    const device = await t.connectDevice(starHandle.device);
    expect(usb.requestCalls).toBe(0);
    expect(device.identity.brand).toBe("star");
    await device.print(Uint8Array.of(0x41));
    expect(star.allBytes()).toEqual(Uint8Array.of(0x41));
  });
});

describe("connect/disconnect events", () => {
  it("notifies subscribers on connect and disconnect with identity", () => {
    const dev = new FakeUsbDevice({ vendorId: VENDOR_IDS.star, productId: 0x0003 });
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);

    const events: string[] = [];
    const off = t.onConnectivityChange((e) => {
      events.push(`${e.type}:${e.identity.brand}:${e.usb.productId}`);
    });

    usb.fireConnect(dev);
    usb.fireDisconnect(dev);
    expect(events).toEqual(["connect:star:3", "disconnect:star:3"]);

    // Unsubscribe tears down the DOM listeners (last listener removed).
    off();
    expect(usb.connectListeners.size).toBe(0);
    expect(usb.disconnectListeners.size).toBe(0);

    usb.fireConnect(dev); // no subscribers — nothing recorded
    expect(events).toHaveLength(2);
  });
});

describe("disconnect()", () => {
  it("releases the interface and closes the device", async () => {
    const dev = new FakeUsbDevice();
    const usb = new FakeUsb([dev]);
    const t = new WebUsbTransport(usb);
    const device = (await t.connect({ kind: "printer", transport: "webusb", usb: { vendorId: dev.vendorId, productId: dev.productId } })) as WebUsbDevice;

    await device.disconnect();
    expect(dev.released).toEqual([0]);
    expect(dev.closeCount).toBe(1);
    await expect(device.status()).resolves.toBe("disconnected");

    // print after disconnect throws.
    await expect(device.print(Uint8Array.of(1))).rejects.toBeInstanceOf(WebUsbUnsupportedError);
  });
});
