import { describe, it, expect } from "vitest";
import {
  capabilitiesOf,
  dedupeDevices,
  describeUsbDevice,
  devicesOfKind,
  findDrawerKicker,
  isWebCapableTransport,
  pickTransport,
  type DiscoveredDevice,
} from "./device-manager";

describe("transport capability", () => {
  it("treats the Web* + network transports as web-capable", () => {
    expect(isWebCapableTransport("webusb")).toBe(true);
    expect(isWebCapableTransport("web_bluetooth")).toBe(true);
    expect(isWebCapableTransport("web_serial")).toBe(true);
    expect(isWebCapableTransport("network_epos")).toBe(true);
    expect(isWebCapableTransport("network_cloudprnt")).toBe(true);
  });

  it("does not treat the local bridge as a pure-web transport", () => {
    expect(isWebCapableTransport("local_bridge")).toBe(false);
  });
});

describe("pickTransport", () => {
  it("prefers direct USB over network rails", () => {
    expect(pickTransport(["network_epos", "webusb"])).toBe("webusb");
  });

  it("falls through the preference order", () => {
    expect(pickTransport(["local_bridge", "network_cloudprnt"])).toBe("network_cloudprnt");
    expect(pickTransport(["web_bluetooth", "local_bridge"])).toBe("web_bluetooth");
  });

  it("returns undefined for an empty candidate set", () => {
    expect(pickTransport([])).toBeUndefined();
  });

  it("does not mutate the input array", () => {
    const input = ["network_epos", "webusb"] as const;
    pickTransport(input);
    expect(input).toEqual(["network_epos", "webusb"]);
  });
});

describe("describeUsbDevice", () => {
  it("resolves identity through the registry", () => {
    const dev = describeUsbDevice({ vendorId: 0x04b8, productId: 0x0202 });
    expect(dev.transport).toBe("webusb");
    expect(dev.identity.model).toBe("TM-T88V");
    expect(capabilitiesOf(dev).paperWidthMm).toBe(80);
  });
});

describe("dedupeDevices", () => {
  it("drops the same USB device enumerated twice (first wins, order kept)", () => {
    const a = describeUsbDevice({ vendorId: 0x04b8, productId: 0x0202 });
    const b = describeUsbDevice({ vendorId: 0x0519, productId: 0x0003 });
    const aAgain = describeUsbDevice({ vendorId: 0x04b8, productId: 0x0202 });
    const out = dedupeDevices([a, b, aAgain]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it("dedupes network devices by transport + endpoint", () => {
    const net = (endpoint: string): DiscoveredDevice => ({
      endpoint,
      transport: "network_epos",
      identity: describeUsbDevice({ vendorId: 0x04b8, productId: 0x0202 }).identity,
    });
    const out = dedupeDevices([net("10.0.0.5"), net("10.0.0.5"), net("10.0.0.6")]);
    expect(out).toHaveLength(2);
  });
});

describe("device filtering", () => {
  const printer = describeUsbDevice({ vendorId: 0x04b8, productId: 0x0202 });
  const genericNoKick = describeUsbDevice({ vendorId: 0x9999, productId: 0x1 });

  it("devicesOfKind filters by peripheral kind", () => {
    const out = devicesOfKind([printer, genericNoKick], "printer");
    expect(out).toHaveLength(2); // both resolve to printers
    expect(devicesOfKind([printer], "cash_drawer")).toHaveLength(0);
  });

  it("findDrawerKicker picks a printer with a drawer-kick port", () => {
    // The generic device has no drawer kick; the Epson does.
    expect(findDrawerKicker([genericNoKick])).toBeUndefined();
    expect(findDrawerKicker([genericNoKick, printer])).toBe(printer);
  });
});
