/**
 * Auto-print-on-sale orchestration (docs/EDITIONS.md §5). Chains the app's stored
 * order receipt → the shared ESC/POS formatter → a connected printer:
 *
 *   getOrderReceipt(orderId)  →  fromOrderReceipt  →  formatReceipt({openDrawer,cut})  →  printer.print(bytes)
 *
 * PURE + INJECTED: it takes a `getReceipt` reader (the local `SqliteDataStore` in
 * the desktop shell) and a `ReceiptPrinter` (the Tauri transport), so it pulls in
 * no store/Tauri runtime and is fully unit-testable. In the local edition the shell
 * calls this right after `checkout`, with `openDrawer` on by default for a cash
 * sale. The byte formatter is shared with the cloud receipt path — identical bytes.
 */
import { fromOrderReceipt, formatReceipt, type OrderReceiptLike, type PaperWidth } from "./escpos";

/** The one method auto-print needs from a printer (Tauri transport satisfies it). */
export interface ReceiptPrinter {
  print(bytes: Uint8Array): Promise<void>;
}

export interface PrintReceiptOptions {
  /** Kick the cash drawer as part of the print. Default true (cash sale). */
  openDrawer?: boolean;
  /** Emit a paper cut at the end. Default true. */
  cut?: boolean;
  /** Thermal paper width. Default 80mm (see escpos CHARS_PER_LINE). */
  paperWidth?: PaperWidth;
  /** Optional QR block value + footer line layered onto the receipt. */
  qrValue?: string | null;
  footer?: string | null;
}

/** Build the ESC/POS bytes for an order receipt (pure — no I/O). */
export function buildOrderReceiptBytes(
  order: OrderReceiptLike,
  opts: PrintReceiptOptions = {},
): Uint8Array {
  const receipt = fromOrderReceipt(order, { qrValue: opts.qrValue, footer: opts.footer });
  return formatReceipt(receipt, {
    openDrawer: opts.openDrawer ?? true,
    cut: opts.cut ?? true,
    paperWidth: opts.paperWidth,
  }).bytes;
}

/** Print an already-loaded order receipt; returns the bytes that were sent. */
export async function printOrderReceipt(
  printer: ReceiptPrinter,
  order: OrderReceiptLike,
  opts: PrintReceiptOptions = {},
): Promise<Uint8Array> {
  const bytes = buildOrderReceiptBytes(order, opts);
  await printer.print(bytes);
  return bytes;
}

/**
 * Full auto-print chain: load the receipt by id (tenant-scoped by the reader),
 * format, and print. Returns the printed bytes, or `null` when no such order exists
 * (a deleted/foreign id) — the caller decides whether that's an error.
 */
export async function printOrderById(args: {
  getReceipt: (orderId: string) => Promise<OrderReceiptLike | null>;
  printer: ReceiptPrinter;
  orderId: string;
  options?: PrintReceiptOptions;
}): Promise<Uint8Array | null> {
  const order = await args.getReceipt(args.orderId);
  if (!order) return null;
  return printOrderReceipt(args.printer, order, args.options);
}
