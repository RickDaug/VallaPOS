/**
 * Offline-edition auto-print wiring (docs/EDITIONS.md §5). Loads/saves the device's
 * printer config in a Tauri store KV and, after a sale, drives the shared auto-print
 * chain through the NATIVE Rust `print_raw` transport:
 *
 *   getOrderReceipt(orderId) → fromOrderReceipt → formatReceipt → createTauriPrinter → print_raw
 *
 * All `@tauri-apps/*` imports are DYNAMIC and behind the `isTauriRuntime` guard, so
 * the cloud bundle never includes them and a browser preview simply no-ops. Every
 * export is best-effort: `autoPrintOrder` returns false (never throws) when there's
 * nothing to print, and throws ONLY if the real print I/O fails — so a print problem
 * surfaces a notice WITHOUT unwinding the already-committed sale.
 */
import { isTauriRuntime } from "@/lib/tauri/runtime";
import { loadTauriKv } from "@/lib/tauri/store-kv";
import { createTauriPrinter, type TauriInvoke } from "./transports/tauri";
import { printOrderById, type PrintReceiptOptions } from "./auto-print";
import type { OrderReceiptLike } from "./escpos";
import {
  DEFAULT_PRINTER_CONFIG,
  isPrinterReady,
  parsePrinterConfig,
  type PrinterConfig,
} from "./printer-config";

const PRINTER_FILE = "vallapos-printer.json";
const PRINTER_KEY = "printer";

/** Load the stored printer config (defaults when unset / not under Tauri). */
export async function loadPrinterConfig(): Promise<PrinterConfig> {
  if (!isTauriRuntime()) return DEFAULT_PRINTER_CONFIG;
  const raw = await (await loadTauriKv(PRINTER_FILE)).get(PRINTER_KEY);
  if (!raw) return DEFAULT_PRINTER_CONFIG;
  try {
    return parsePrinterConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

/** Persist the printer config. */
export async function savePrinterConfig(config: PrinterConfig): Promise<void> {
  await (await loadTauriKv(PRINTER_FILE)).set(PRINTER_KEY, JSON.stringify(config));
}

/**
 * Print an order's receipt to the configured native printer. Returns false (no I/O)
 * when not under Tauri, the printer isn't enabled/addressed, or the order can't be
 * loaded; true once bytes were sent. Rejects only on a real transport failure.
 */
export async function autoPrintOrder(args: {
  getReceipt: (orderId: string) => Promise<OrderReceiptLike | null>;
  orderId: string;
  config?: PrinterConfig;
}): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const config = args.config ?? (await loadPrinterConfig());
  if (!isPrinterReady(config)) return false;

  const { invoke } = await import("@tauri-apps/api/core");
  const printer = createTauriPrinter(invoke as TauriInvoke, {
    kind: config.kind,
    address: config.address.trim(),
  });
  const options: PrintReceiptOptions = {
    openDrawer: config.openDrawer,
    paperWidth: config.paperWidth,
  };
  const bytes = await printOrderById({
    getReceipt: args.getReceipt,
    printer,
    orderId: args.orderId,
    options,
  });
  return bytes !== null;
}
