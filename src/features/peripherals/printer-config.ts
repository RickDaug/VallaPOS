/**
 * Offline-edition receipt-printer configuration (docs/EDITIONS.md §5). Device-local
 * (not business data — a shop could run two terminals with different printers), so it
 * lives in a Tauri store KV rather than the SQLite `business` row. Pure + tolerant:
 * `parsePrinterConfig` always returns a valid config (defaults on anything malformed),
 * so a hand-edited/legacy file can never crash the register. `address` mirrors the Rust
 * `print_raw` target — "host[:9100]" (tcp), a printer name (windows_spooler), or a COM
 * port (serial).
 */
import { z } from "zod";

export const PRINTER_KINDS = ["tcp", "windows_spooler", "serial"] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export const printerConfigSchema = z.object({
  /** Master switch — auto-print fires only when true (and an address is set). */
  enabled: z.boolean().default(false),
  /** Which Rust `print_raw` transport to use. */
  kind: z.enum(PRINTER_KINDS).default("tcp"),
  /** host[:9100] (tcp) | printer name (windows_spooler) | COM port (serial). */
  address: z.string().default(""),
  /** Kick the cash drawer as part of each print. Default on for a cash till. */
  openDrawer: z.boolean().default(true),
  /** Thermal paper width in mm. */
  paperWidth: z.union([z.literal(58), z.literal(80)]).default(80),
});

export type PrinterConfig = z.infer<typeof printerConfigSchema>;

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  enabled: false,
  kind: "tcp",
  address: "",
  openDrawer: true,
  paperWidth: 80,
};

/** Parse stored config tolerantly — always a valid config (defaults on bad input). */
export function parsePrinterConfig(raw: unknown): PrinterConfig {
  const parsed = printerConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PRINTER_CONFIG;
}

/** True when auto-print should fire: enabled AND a non-empty address. */
export function isPrinterReady(cfg: PrinterConfig): boolean {
  return cfg.enabled && cfg.address.trim().length > 0;
}
