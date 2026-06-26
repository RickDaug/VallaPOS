/**
 * Peripherals groundwork — a PURE, HARDWARE-FREE ESC/POS receipt formatter.
 *
 * ⚠ INERT SCAFFOLD. No live path imports this yet. This module turns a receipt
 * into an ESC/POS command byte stream (`Uint8Array`) that can later be shipped to
 * an Epson or Star thermal printer (both speak ESC/POS) over whatever transport a
 * future native shell / WebUSB / Bluetooth bridge provides. It is the formatting
 * building block ONLY — it does NOT touch hardware, the DOM, the network, or any
 * server-only code, and it pulls in NO dependencies. That makes the whole thing
 * fully unit-testable WITHOUT a printer: you assert on the produced bytes.
 *
 * Money convention mirrors `@/lib/money.ts` `formatMoney` (integer cents →
 * currency string) but is reimplemented locally with a tiny `Intl.NumberFormat`
 * call so this module stays dependency-light and self-contained.
 *
 * Define your OWN input type (`EscPosReceipt`) here — do NOT import the app's DB
 * receipt shapes directly. `fromOrderReceipt` / `fromCheckoutReceipt` map the
 * shapes the app already produces (`OrderReceipt`, `Receipt`) onto this input so
 * the formatter input matches reality without coupling to the schema.
 */

// ---------------------------------------------------------------------------
// ESC/POS command bytes (the raw protocol constants).
// ---------------------------------------------------------------------------

const ESC = 0x1b; // ESC
const GS = 0x1d; // GS
const LF = 0x0a; // line feed
const DLE = 0x10; // data link escape
const DC4 = 0x14; // device control 4

/** Reusable command sequences. Exported for tests to assert byte order. */
export const CMD = {
  /** ESC @ — initialize printer (clears formatting, buffer). */
  INIT: Uint8Array.of(ESC, 0x40),
  LINE_FEED: Uint8Array.of(LF),

  // Justification — ESC a n  (0 left, 1 center, 2 right).
  ALIGN_LEFT: Uint8Array.of(ESC, 0x61, 0),
  ALIGN_CENTER: Uint8Array.of(ESC, 0x61, 1),
  ALIGN_RIGHT: Uint8Array.of(ESC, 0x61, 2),

  // Emphasis — ESC E n  (1 on, 0 off).
  BOLD_ON: Uint8Array.of(ESC, 0x45, 1),
  BOLD_OFF: Uint8Array.of(ESC, 0x45, 0),

  // Character size — GS ! n  (bit 0-2 height multiplier, bit 4-6 width).
  // 0x00 normal, 0x01 double-height, 0x11 double-width + double-height.
  SIZE_NORMAL: Uint8Array.of(GS, 0x21, 0x00),
  SIZE_DOUBLE_HEIGHT: Uint8Array.of(GS, 0x21, 0x01),
  SIZE_DOUBLE: Uint8Array.of(GS, 0x21, 0x11),

  /** GS V 66 0 — partial cut after feeding (the common "cut here" command). */
  CUT: Uint8Array.of(GS, 0x56, 66, 0),

  /**
   * Cash-drawer kick. ESC p m t1 t2 — pulse connector pin `m` (0 = pin 2,
   * 1 = pin 5) for on/off durations. 0x19/0xFA ≈ 25ms on / 250ms off, the
   * widely-compatible default. DLE DC4 is the alternate real-time form.
   */
  DRAWER_KICK_PIN2: Uint8Array.of(ESC, 0x70, 0, 0x19, 0xfa),
  DRAWER_KICK_PIN5: Uint8Array.of(ESC, 0x70, 1, 0x19, 0xfa),
  DRAWER_KICK_REALTIME: Uint8Array.of(DLE, DC4, 1, 0, 1),
} as const;

// ---------------------------------------------------------------------------
// Paper width.
// ---------------------------------------------------------------------------

/** Supported thermal paper widths. Chars-per-line differs (Font A, normal). */
export type PaperWidth = 58 | 80;

/** Characters per line for a given paper width at the default Font A size. */
export const CHARS_PER_LINE: Record<PaperWidth, number> = {
  58: 32,
  80: 48,
};

export interface EscPosOptions {
  /** Receipt paper width in mm. Default 80mm. */
  paperWidth?: PaperWidth;
  /**
   * Encoding NOTE only. This formatter emits the printer's default code page
   * (ASCII-safe; non-ASCII is transliterated to `?`). A real multi-byte/legacy
   * code-page selection (ESC t n) is out of scope for this groundwork — the
   * field documents intent and is surfaced on the built result for callers.
   */
  encoding?: string;
  /** Open the cash drawer as part of the print (fires a kick before the cut). */
  openDrawer?: boolean;
  /** Emit a paper cut at the end. Default true. */
  cut?: boolean;
}

// ---------------------------------------------------------------------------
// Formatter input — OUR OWN shape (intentionally decoupled from the DB types).
// ---------------------------------------------------------------------------

export interface EscPosModifier {
  name: string;
  priceDeltaCents: number;
}

export interface EscPosLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers?: EscPosModifier[];
}

export interface EscPosPayment {
  /** Human label, e.g. "Cash", "QR", "Other". */
  methodLabel: string;
  amountCents: number;
  tenderedCents?: number | null;
  changeCents?: number | null;
  /** Optional reference note (manual tender). */
  note?: string | null;
}

export interface EscPosReceipt {
  businessName: string;
  orderNumber: number;
  /** ISO timestamp or any preformatted string. */
  createdAt: string;
  currency?: string;
  customerName?: string | null;

  lines: EscPosLine[];

  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;

  payments: EscPosPayment[];

  /** Optional merchant QR-pay value to render as a QR block (PIX key, link…). */
  qrValue?: string | null;
  /** Optional footer line, e.g. "Thank you!". */
  footer?: string | null;
}

// ---------------------------------------------------------------------------
// Money + text helpers (dependency-light local formatter mirroring formatMoney).
// ---------------------------------------------------------------------------

/** Mirror of `@/lib/money.ts` formatMoney — integer cents → currency string. */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Encode a string to bytes, transliterating non-ASCII to `?` (code-page safe). */
function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i] = code <= 0x7f ? code : 0x3f; // '?'
  }
  return out;
}

/** Concatenate byte chunks into one Uint8Array. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Lay a left label and right value on one line padded to `width` columns. If the
 * combined length overflows, the value wins and the label is truncated.
 */
function twoColumn(left: string, right: string, width: number): string {
  const space = width - right.length;
  if (space <= 0) return right.slice(-width);
  const leftClipped = left.length > space ? left.slice(0, space - 1) + " " : left;
  const gap = width - leftClipped.length - right.length;
  return leftClipped + " ".repeat(Math.max(gap, 0)) + right;
}

// ---------------------------------------------------------------------------
// QR code — ESC/POS GS ( k, model 2.
// ---------------------------------------------------------------------------

/**
 * Build the GS ( k QR-code command block for `data` (model 2). Sequence:
 *  1. select model 2,
 *  2. set module size,
 *  3. set error-correction level,
 *  4. store the data in symbol storage,
 *  5. print the stored symbol.
 *
 * `pL pH` encode the byte length as (len & 0xff, len >> 8). Exported so it can be
 * unit-tested and reused.
 */
export function qrCode(data: string, moduleSize = 6): Uint8Array {
  const bytes = encodeAscii(data);
  // Store length is data length + 3 (for the cn, fn, m prefix bytes 49 80 48).
  const storeLen = bytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;

  const selectModel = Uint8Array.of(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  const setSize = Uint8Array.of(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize & 0xff);
  // Error correction level 49 ('1' = L). 48 L,49 M? Epson: 48=L,49=M,50=Q,51=H.
  const setErrorCorrection = Uint8Array.of(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
  const storeData = concatBytes([
    Uint8Array.of(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30),
    bytes,
  ]);
  const printSymbol = Uint8Array.of(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);

  return concatBytes([selectModel, setSize, setErrorCorrection, storeData, printSymbol]);
}

// ---------------------------------------------------------------------------
// Drawer kick helper — fire WITHOUT a print.
// ---------------------------------------------------------------------------

/**
 * Stand-alone cash-drawer kick byte stream. Init + a pulse on the chosen pin,
 * so it can be sent to the printer to pop the drawer with or without printing a
 * receipt. Pin 2 is the common default; some hardware wires the drawer to pin 5.
 */
export function drawerKick(pin: 2 | 5 = 2): Uint8Array {
  return concatBytes([CMD.INIT, pin === 5 ? CMD.DRAWER_KICK_PIN5 : CMD.DRAWER_KICK_PIN2]);
}

// ---------------------------------------------------------------------------
// The builder — assemble a receipt into a deterministic byte stream.
// ---------------------------------------------------------------------------

class EscPosBuilder {
  private chunks: Uint8Array[] = [];

  raw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    return this;
  }

  /** Append text (ASCII-encoded) with no trailing feed. */
  text(value: string): this {
    return this.raw(encodeAscii(value));
  }

  /** Append text followed by a line feed. */
  line(value = ""): this {
    return this.text(value).raw(CMD.LINE_FEED);
  }

  feed(count = 1): this {
    for (let i = 0; i < count; i++) this.raw(CMD.LINE_FEED);
    return this;
  }

  alignLeft(): this {
    return this.raw(CMD.ALIGN_LEFT);
  }
  alignCenter(): this {
    return this.raw(CMD.ALIGN_CENTER);
  }
  alignRight(): this {
    return this.raw(CMD.ALIGN_RIGHT);
  }
  boldOn(): this {
    return this.raw(CMD.BOLD_ON);
  }
  boldOff(): this {
    return this.raw(CMD.BOLD_OFF);
  }

  build(): Uint8Array {
    return concatBytes(this.chunks);
  }
}

/** Result of formatting — the bytes plus the resolved options (for callers). */
export interface EscPosResult {
  bytes: Uint8Array;
  paperWidth: PaperWidth;
  charsPerLine: number;
  encoding: string;
}

/**
 * Format an `EscPosReceipt` into a deterministic ESC/POS byte stream.
 *
 * Layout: init → centered bold business name → order # + timestamp → optional
 * customer → line items (name + qty×unit, right-aligned line total) with indented
 * modifiers → totals block (subtotal/discount/tax/tip/total; total bold + double
 * height) → payment(s) → optional QR block → footer → drawer kick (optional) →
 * paper cut (optional). Same input always yields the same bytes.
 */
export function formatReceipt(receipt: EscPosReceipt, options: EscPosOptions = {}): EscPosResult {
  const paperWidth: PaperWidth = options.paperWidth ?? 80;
  const width = CHARS_PER_LINE[paperWidth];
  const currency = receipt.currency ?? "USD";
  const encoding = options.encoding ?? "ascii";
  const money = (cents: number) => formatMoney(cents, currency);

  const b = new EscPosBuilder();

  // 1. Init.
  b.raw(CMD.INIT);

  // 2. Header — centered, bold, double-size business name.
  b.alignCenter().boldOn().raw(CMD.SIZE_DOUBLE);
  b.line(receipt.businessName);
  b.raw(CMD.SIZE_NORMAL).boldOff();

  // 3. Order number + timestamp (centered).
  b.line(`Order #${receipt.orderNumber}`);
  b.line(receipt.createdAt);
  if (receipt.customerName) b.line(receipt.customerName);

  // 4. Line items — left aligned.
  b.alignLeft();
  b.line("-".repeat(width));
  for (const item of receipt.lines) {
    const qtyUnit = `${item.quantity} x ${money(item.unitPriceCents)}`;
    b.line(twoColumn(item.name, money(item.lineTotalCents), width));
    b.line(`  ${qtyUnit}`);
    for (const mod of item.modifiers ?? []) {
      const modRight = mod.priceDeltaCents ? money(mod.priceDeltaCents) : "";
      b.line(twoColumn(`  + ${mod.name}`, modRight, width));
    }
  }
  b.line("-".repeat(width));

  // 5. Totals block.
  b.line(twoColumn("Subtotal", money(receipt.subtotalCents), width));
  if (receipt.discountCents > 0) {
    b.line(twoColumn("Discount", `-${money(receipt.discountCents)}`, width));
  }
  b.line(twoColumn("Tax", money(receipt.taxCents), width));
  if (receipt.tipCents > 0) {
    b.line(twoColumn("Tip", money(receipt.tipCents), width));
  }
  // Total — bold + double height for emphasis.
  b.boldOn().raw(CMD.SIZE_DOUBLE_HEIGHT);
  b.line(twoColumn("TOTAL", money(receipt.totalCents), Math.floor(width / 2)));
  b.raw(CMD.SIZE_NORMAL).boldOff();

  // 6. Payment(s).
  b.line("-".repeat(width));
  for (const p of receipt.payments) {
    b.line(twoColumn(p.methodLabel, money(p.amountCents), width));
    if (p.tenderedCents != null && p.tenderedCents > 0) {
      b.line(twoColumn("  Tendered", money(p.tenderedCents), width));
    }
    if (p.changeCents != null && p.changeCents > 0) {
      b.line(twoColumn("  Change", money(p.changeCents), width));
    }
    if (p.note) b.line(`  Ref: ${p.note}`);
  }

  // 7. QR block (centered) when a merchant QR-pay value is present.
  if (receipt.qrValue) {
    b.feed(1).alignCenter();
    b.line("Scan to pay");
    b.raw(qrCode(receipt.qrValue));
    b.alignLeft();
  }

  // 8. Footer.
  if (receipt.footer) {
    b.feed(1).alignCenter().line(receipt.footer).alignLeft();
  }

  // Feed clear of the print head before any cut.
  b.feed(3);

  // 9. Drawer kick (optional) — fired before the cut so the drawer pops.
  if (options.openDrawer) {
    b.raw(CMD.DRAWER_KICK_PIN2);
  }

  // 10. Paper cut (default on).
  if (options.cut !== false) {
    b.raw(CMD.CUT);
  }

  return { bytes: b.build(), paperWidth, charsPerLine: width, encoding };
}

// ---------------------------------------------------------------------------
// Mappers from the app's existing receipt shapes onto EscPosReceipt.
//
// These take STRUCTURAL (duck-typed) inputs so this module never imports the
// server-only DB query/action modules. The fields line up with `OrderReceipt`
// (src/features/orders/queries.ts) and `Receipt` (src/features/register/schema.ts).
// ---------------------------------------------------------------------------

/** Minimal shape of the app's `OrderReceipt` this mapper consumes. */
export interface OrderReceiptLike {
  number: number;
  createdAt: string;
  customerName: string | null;
  businessName: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  lines: {
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    modifiers: { name: string; priceDeltaCents: number }[];
  }[];
  payments: {
    method: string;
    amountCents: number;
    tenderedCents: number | null;
    changeCents: number | null;
    manualNote: string | null;
  }[];
}

/** Human label for a `PaymentMethod`, mirroring the app's paymentMethodLabel. */
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Cash";
    case "QR":
      return "QR";
    case "MANUAL":
      return "Other";
    case "CARD":
      return "Card";
    default:
      return method;
  }
}

/**
 * Map the app's full order receipt (`OrderReceipt`) onto the formatter input.
 * `qrValue`/`footer` are optional extras the caller can layer on.
 */
export function fromOrderReceipt(
  order: OrderReceiptLike,
  extras: { qrValue?: string | null; footer?: string | null } = {},
): EscPosReceipt {
  return {
    businessName: order.businessName,
    orderNumber: order.number,
    createdAt: order.createdAt,
    currency: order.currency,
    customerName: order.customerName,
    lines: order.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.totalCents,
      modifiers: l.modifiers.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents })),
    })),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    payments: order.payments.map((p) => ({
      methodLabel: paymentMethodLabel(p.method),
      amountCents: p.amountCents,
      tenderedCents: p.tenderedCents,
      changeCents: p.changeCents,
      note: p.manualNote,
    })),
    qrValue: extras.qrValue ?? null,
    footer: extras.footer ?? null,
  };
}

/** Minimal shape of the checkout `Receipt` this mapper consumes. */
export interface CheckoutReceiptLike {
  number: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  method: string;
  cashTenderedCents: number;
  changeCents: number;
  manualNote: string | null;
}

/**
 * Map the lean checkout `Receipt` (no line detail) onto the formatter input.
 * The checkout result intentionally omits line items, so the formatted receipt
 * is a totals-only stub; pass `businessName`/`createdAt` (and optional QR/footer)
 * from the calling context.
 */
export function fromCheckoutReceipt(
  receipt: CheckoutReceiptLike,
  context: {
    businessName: string;
    createdAt: string;
    currency?: string;
    customerName?: string | null;
    qrValue?: string | null;
    footer?: string | null;
  },
): EscPosReceipt {
  const isCash = receipt.method === "CASH";
  return {
    businessName: context.businessName,
    orderNumber: receipt.number,
    createdAt: context.createdAt,
    currency: context.currency ?? "USD",
    customerName: context.customerName ?? null,
    lines: [],
    subtotalCents: receipt.subtotalCents,
    discountCents: receipt.discountCents,
    taxCents: receipt.taxCents,
    tipCents: receipt.tipCents,
    totalCents: receipt.totalCents,
    payments: [
      {
        methodLabel: paymentMethodLabel(receipt.method),
        amountCents: receipt.totalCents,
        tenderedCents: isCash ? receipt.cashTenderedCents : null,
        changeCents: isCash ? receipt.changeCents : null,
        note: receipt.manualNote,
      },
    ],
    qrValue: context.qrValue ?? null,
    footer: context.footer ?? null,
  };
}
