/**
 * Peripherals — NATIVE (Tauri) printer transport (docs/EDITIONS.md §3/§5).
 *
 * The offline desktop edition drives the thermal printer + cash drawer through a
 * Rust `#[tauri::command]` (`print_raw`) rather than WebUSB — the native path turns
 * the Windows `usbprint.sys` driver claim (a WebUSB blocker) into the SUPPORTED
 * transport, and also reaches network (TCP 9100) and serial printers the browser
 * can't. The ESC/POS BYTE FORMATTER is unchanged (`escpos.ts`); only the transport
 * is new — this module forwards an opaque byte buffer to Rust.
 *
 * NO `@tauri-apps` IMPORT: the `invoke` function is INJECTED (mirroring the
 * injectable `usb` in `./webusb.ts`), so this module needs no Tauri dependency and
 * is unit-testable against a fake. The desktop shell passes the real
 * `@tauri-apps/api/core` `invoke` — that one line is the piece that needs the Tauri
 * runtime (Stage 5-finish).
 */
import { drawerKick } from "../escpos";

/** Signature of `@tauri-apps/api/core`'s `invoke`. Declared locally (no dep). */
export type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Where the Rust `print_raw` command should send the bytes. Mirrors the transports
 * `docs/PERIPHERALS.md` recommends for a shipped desktop product:
 *  - `tcp`: raw JetDirect port 9100 (`address` = "host" or "host:9100") — the
 *    robust, driver-free first-class path.
 *  - `windows_spooler`: a RAW job to an installed printer (`address` = printer name).
 *  - `serial`: a COM/tty port (`address` = "COM3" / "/dev/ttyUSB0").
 */
export interface NativePrintTarget {
  kind: "tcp" | "windows_spooler" | "serial";
  address: string;
}

/** A connected native printer: forwards opaque ESC/POS bytes + a drawer kick. */
export interface NativePrinter {
  readonly target: NativePrintTarget;
  /** Send a raw ESC/POS byte stream (built by `escpos.ts`) to the device. */
  print(bytes: Uint8Array): Promise<void>;
  /** Fire the printer-driven cash-drawer kick (RJ11 DK port). */
  kickDrawer(pin?: 2 | 5): Promise<void>;
}

/**
 * Construct a native printer bound to `target`, driven by the injected `invoke`.
 * Bytes cross the Tauri IPC bridge as a plain number array (`Array.from`), which
 * the Rust side reads back into a `Vec<u8>`. `kickDrawer` reuses the shared
 * `escpos.drawerKick()` sequence (single source of truth) sent via the same
 * `print_raw` command, so no second Rust command is required.
 */
export function createTauriPrinter(invoke: TauriInvoke, target: NativePrintTarget): NativePrinter {
  async function printRaw(bytes: Uint8Array): Promise<void> {
    await invoke("print_raw", { target, data: Array.from(bytes) });
  }
  return {
    target,
    print: printRaw,
    kickDrawer: (pin: 2 | 5 = 2) => printRaw(drawerKick(pin)),
  };
}
