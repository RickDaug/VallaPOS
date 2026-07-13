import { describe, expect, it, vi } from "vitest";
import { createTauriPrinter, type TauriInvoke } from "./tauri";
import { drawerKick } from "../escpos";

describe("createTauriPrinter (native Tauri transport)", () => {
  it("forwards print bytes to the print_raw command as a number array", async () => {
    const invoke = vi.fn(async () => undefined);
    const target = { kind: "tcp" as const, address: "192.168.0.50:9100" };
    const printer = createTauriPrinter(invoke as unknown as TauriInvoke, target);

    await printer.print(new Uint8Array([1, 2, 3, 255]));
    expect(invoke).toHaveBeenCalledWith("print_raw", { target, data: [1, 2, 3, 255] });
  });

  it("kickDrawer sends the shared escpos drawerKick(pin) sequence via print_raw", async () => {
    const invoke = vi.fn(async () => undefined);
    const target = { kind: "windows_spooler" as const, address: "EPSON TM-T88" };
    const printer = createTauriPrinter(invoke as unknown as TauriInvoke, target);

    await printer.kickDrawer(5);
    expect(invoke).toHaveBeenCalledWith("print_raw", { target, data: Array.from(drawerKick(5)) });
  });

  it("defaults the drawer kick to pin 2", async () => {
    const invoke = vi.fn(async () => undefined);
    const printer = createTauriPrinter(invoke as unknown as TauriInvoke, {
      kind: "serial",
      address: "COM3",
    });

    await printer.kickDrawer();
    expect(invoke).toHaveBeenCalledWith("print_raw", {
      target: { kind: "serial", address: "COM3" },
      data: Array.from(drawerKick(2)),
    });
  });
});
