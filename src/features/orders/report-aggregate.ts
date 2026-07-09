/**
 * Pure reporting aggregation + CSV serialization (no `server-only` import, so
 * it's unit-testable). The DB layer in `queries.ts` resolves rows and hands
 * them here; nothing in this file touches Prisma. Money stays in integer cents.
 */

export interface AggregateLineInput {
  /** Durable item name captured on the order line (survives catalog edits). */
  nameSnapshot: string;
  quantity: number;
  /** Pre-tax line revenue: `(unitPrice + modifiers) * qty - discount`. */
  totalCents: number;
  taxCents: number;
  /** Best-effort category name; null when uncategorized or the catalog row is gone. */
  categoryName: string | null;
}

export interface ItemSalesRow {
  name: string;
  quantity: number;
  netSalesCents: number;
  taxCents: number;
}

export interface CategorySalesRow {
  category: string;
  quantity: number;
  netSalesCents: number;
}

export interface ItemSalesReport {
  byItem: ItemSalesRow[];
  byCategory: CategorySalesRow[];
}

export interface CashierSalesRow {
  cashier: string; // resolved display name (or "Unattributed" when no cashier)
  orderCount: number;
  netSalesCents: number;
}

/**
 * Whether a tender's "collected" amount is backed by independent evidence.
 *
 * CASH is reconciled against the physical drawer count, so it is `verified`.
 * QR and MANUAL ("Other") are operator-confirmed — the cashier marks them paid
 * with no cash drawer and no PSP/webhook to prove the money actually arrived —
 * so they are `unverified` (a shrinkage / audit blind spot to surface).
 */
export type TenderVerification = "verified" | "unverified";

export function tenderVerification(method: string): TenderVerification {
  return method === "CASH" ? "verified" : "unverified";
}

export interface TenderRow {
  method: string; // stored PaymentMethod enum value
  count: number;
  amountCents: number; // NET movement: includes negative refund reversals
  verification: TenderVerification;
}

export interface TenderBreakdown {
  rows: TenderRow[];
  /** Σ amountCents over CASH (drawer-reconciled) tenders. */
  verifiedCollectedCents: number;
  /**
   * Σ amountCents over operator-confirmed tenders (QR + MANUAL). This is the
   * audit figure: money counted as collected with no drawer/PSP evidence.
   */
  unverifiedCollectedCents: number;
}

/**
 * Roll payment movements up into a per-tender breakdown, classifying each
 * method as drawer-verified (CASH) or operator-confirmed/unverified (QR,
 * MANUAL, and any future non-cash method). Amounts are NET — the negative
 * reversing payments from refunds/voids are included, so a refund reduces the
 * collected figure for that tender. Rows are sorted by amount descending, then
 * method ascending for a stable tie-break.
 */
export function aggregateTenders(
  payments: { method: string; amountCents: number }[],
): TenderBreakdown {
  const map = new Map<string, TenderRow>();
  for (const p of payments) {
    const verification = tenderVerification(p.method);
    const row = map.get(p.method) ?? {
      method: p.method,
      count: 0,
      amountCents: 0,
      verification,
    };
    row.count += 1;
    row.amountCents += p.amountCents;
    map.set(p.method, row);
  }

  const rows = [...map.values()].sort(
    (a, b) => b.amountCents - a.amountCents || a.method.localeCompare(b.method),
  );

  let verifiedCollectedCents = 0;
  let unverifiedCollectedCents = 0;
  for (const row of rows) {
    if (row.verification === "verified") verifiedCollectedCents += row.amountCents;
    else unverifiedCollectedCents += row.amountCents;
  }

  return { rows, verifiedCollectedCents, unverifiedCollectedCents };
}

/**
 * Roll orders up per cashier (one input row per order). Sorted by net sales
 * descending, then name ascending for a stable tie-break.
 */
export function aggregateCashierSales(
  orders: { cashier: string; netSalesCents: number }[],
): CashierSalesRow[] {
  const map = new Map<string, CashierSalesRow>();
  for (const o of orders) {
    const row = map.get(o.cashier) ?? { cashier: o.cashier, orderCount: 0, netSalesCents: 0 };
    row.orderCount += 1;
    row.netSalesCents += o.netSalesCents;
    map.set(o.cashier, row);
  }
  return [...map.values()].sort(
    (a, b) => b.netSalesCents - a.netSalesCents || a.cashier.localeCompare(b.cashier),
  );
}

export interface ReportRange {
  /** Inclusive start day, `YYYY-MM-DD`. */
  fromStr: string;
  /** Inclusive end day, `YYYY-MM-DD`. */
  toStr: string;
  /** Display label: a single date, or `"from – to"` for a multi-day range. */
  label: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a reporting date range from raw query params. Both bounds default to
 * `today` (a single-day report) and any malformed value falls back to `today`.
 * The range is always well-ordered — if `from` is later than `to` the two are
 * swapped — so callers can trust `fromStr <= toStr`. Pure (string-only, no
 * `Date`) so it's unit-testable; the caller turns the strings into a
 * `[start, end)` Date window.
 */
export function resolveReportRange(
  fromParam: string | undefined,
  toParam: string | undefined,
  today: string,
): ReportRange {
  const norm = (v: string | undefined) => (v && DATE_RE.test(v) ? v : today);
  let fromStr = norm(fromParam);
  let toStr = norm(toParam);
  // YYYY-MM-DD sorts lexicographically, so a plain string compare orders days.
  if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];
  const label = fromStr === toStr ? fromStr : `${fromStr} – ${toStr}`;
  return { fromStr, toStr, label };
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone-aware day windows (dependency-free — Intl + offset math, no tz lib).
//
// Report day boundaries and displayed timestamps must follow the MERCHANT's
// timezone, not the server's UTC clock, or a late-evening sale lands in the
// wrong Z-report day. These helpers turn a local calendar day (YYYY-MM-DD in an
// IANA zone) into the exact UTC instants that bound it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Milliseconds `timeZone` is ahead of UTC AT `instant` (positive east of UTC,
 * negative west). Works by formatting the instant as wall-clock time in the zone
 * and reading those fields back as if they were UTC, then diffing. Because the
 * offset is sampled at `instant`, DST is handled correctly.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23", // 00–23 (avoids the "24:00" midnight quirk of hour12:false)
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * The UTC instant of local midnight (00:00:00) on `dateStr` (YYYY-MM-DD) in
 * `timeZone`. Two-pass so it converges even when the zone's UTC offset at the
 * naive guess differs from the offset at true local midnight (DST edges).
 */
export function zonedDayStartUtc(dateStr: string, timeZone: string): Date {
  const [ys, ms, ds] = dateStr.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset1 = timeZoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset1;
  const offset2 = timeZoneOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc);
}

/** Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD (calendar-safe, UTC arithmetic). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [ys, ms, ds] = dateStr.split("-");
  const dt = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Today's calendar date (YYYY-MM-DD) as it reads on the wall clock in `timeZone`. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const UNCATEGORIZED = "Uncategorized";

/**
 * Roll order lines up into per-item and per-category totals. Both lists are
 * sorted by net sales descending, then name ascending for a stable tie-break.
 */
export function aggregateItemSales(lines: AggregateLineInput[]): ItemSalesReport {
  const items = new Map<string, ItemSalesRow>();
  const categories = new Map<string, CategorySalesRow>();

  for (const line of lines) {
    const item = items.get(line.nameSnapshot) ?? {
      name: line.nameSnapshot,
      quantity: 0,
      netSalesCents: 0,
      taxCents: 0,
    };
    item.quantity += line.quantity;
    item.netSalesCents += line.totalCents;
    item.taxCents += line.taxCents;
    items.set(line.nameSnapshot, item);

    const categoryName = line.categoryName ?? UNCATEGORIZED;
    const category = categories.get(categoryName) ?? {
      category: categoryName,
      quantity: 0,
      netSalesCents: 0,
    };
    category.quantity += line.quantity;
    category.netSalesCents += line.totalCents;
    categories.set(categoryName, category);
  }

  const byNetThenName = <T extends { netSalesCents: number }>(a: T, b: T, an: string, bn: string) =>
    b.netSalesCents - a.netSalesCents || an.localeCompare(bn);

  return {
    byItem: [...items.values()].sort((a, b) => byNetThenName(a, b, a.name, b.name)),
    byCategory: [...categories.values()].sort((a, b) => byNetThenName(a, b, a.category, b.category)),
  };
}

/** Cents → a plain decimal string for spreadsheets (e.g. 1083 → "10.83"). */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Neutralize CSV formula injection in a USER-CONTROLLED TEXT cell. A spreadsheet
 * evaluates any cell beginning with `= + - @` as a formula. It also STRIPS a
 * leading control char (tab, CR, LF/newline, vertical tab, form feed) before
 * parsing, so a value like `"\n=1+1"` still evaluates -- and RFC-4180 quoting
 * for the newline does NOT stop that. So a malicious item/category name like
 * `=cmd|...` OR `\n=cmd|...` could run on open; we neutralize any leading
 * formula trigger or C0 control char by prefixing the cell with a single quote
 * `'` so the spreadsheet treats it as literal text.
 *
 * IMPORTANT: apply this ONLY to text cells (item name, category). It must NOT
 * touch numeric/amount cells: `centsToAmount` legitimately emits values like
 * "-2.50" for refunds, and prefixing those with `'` would turn them into text
 * and break `SUM()` in the exported report.
 */
export function sanitizeTextCell(s: string): string {
  // Formula triggers (= + - @) OR any leading C0 control char (\x00-\x1f, which
  // includes \t, \n and \r): a leading control char is stripped before the
  // spreadsheet parses the cell, so a leading newline must be neutralized too.
  return /^[=+\-@]/.test(s) || /^[\x00-\x1f]/.test(s) ? `'${s}` : s;
}

/** Escape one CSV field per RFC 4180 (quote if it contains comma/quote/newline). */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(",");
}

export interface ReportCsvInput {
  dateStr: string;
  currency: string;
  orderCount: number;
  grossSalesCents: number;
  discountCents: number;
  netSalesCents: number;
  taxCents: number;
  tipCents: number;
  refundsCents: number; // total reversed money in the window (positive)
  totalCollectedCents: number;
  byMethod: { method: string; count: number; amountCents: number }[];
  /** Per-tender verified/unverified breakdown for the audit section. */
  tenders: TenderBreakdown;
  /** Human-readable label for a stored PaymentMethod (e.g. MANUAL -> "Other"). */
  methodLabel: (method: string) => string;
  items: ItemSalesReport;
  /** Optional per-cashier breakdown; omitted (or empty) hides the section. */
  cashiers?: CashierSalesRow[];
}

const UNVERIFIED_NOTE = "Unverified — operator-confirmed, no drawer/PSP evidence";
const VERIFIED_NOTE = "Verified (in-drawer)";

/**
 * Serialize the day's report to a multi-section CSV (CRLF line endings, RFC
 * 4180 escaping). Amounts are plain decimals so a spreadsheet can sum them.
 */
export function buildReportCsv(input: ReportCsvInput): string {
  const amt = centsToAmount;
  const rows: (string | number)[][] = [
    ["VallaPOS sales report", input.dateStr],
    [`Amounts in ${input.currency}`],
    [],
    ["Summary"],
    ["Orders", input.orderCount],
    ["Gross sales", amt(input.grossSalesCents)],
    ["Discounts", amt(input.discountCents)],
    ["Net sales", amt(input.netSalesCents)],
    ["Tax", amt(input.taxCents)],
    ["Tips", amt(input.tipCents)],
    ["Refunds", amt(input.refundsCents)],
    ["Total collected", amt(input.totalCollectedCents)],
    [],
    ["Payments", "Count", "Amount"],
    ...input.byMethod.map((m) => [m.method, m.count, amt(m.amountCents)]),
    [],
    // Tender audit: per-method collected amount + whether it is drawer-verified
    // or merely operator-confirmed. The note cell is a fixed string (not
    // user-controlled) but sanitized for defense-in-depth consistency.
    ["Payments by tender", "Count", "Amount", "Verification"],
    ...input.tenders.rows.map((t) => [
      sanitizeTextCell(input.methodLabel(t.method)),
      t.count,
      amt(t.amountCents),
      sanitizeTextCell(t.verification === "verified" ? VERIFIED_NOTE : UNVERIFIED_NOTE),
    ]),
    ["Verified collected (in-drawer)", "", amt(input.tenders.verifiedCollectedCents)],
    ["Unverified collected (operator-confirmed)", "", amt(input.tenders.unverifiedCollectedCents)],
    [],
    ["Sales by item", "Quantity", "Net sales", "Tax"],
    // `i.name` is user-controlled (the item's name snapshot) — sanitize against
    // CSV formula injection. Amount cells stay raw so spreadsheets can sum them.
    ...input.items.byItem.map((i) => [
      sanitizeTextCell(i.name),
      i.quantity,
      amt(i.netSalesCents),
      amt(i.taxCents),
    ]),
    [],
    ["Sales by category", "Quantity", "Net sales"],
    // `c.category` is user-controlled (a catalog category name) — sanitize too.
    ...input.items.byCategory.map((c) => [
      sanitizeTextCell(c.category),
      c.quantity,
      amt(c.netSalesCents),
    ]),
  ];

  // Optional per-cashier section (only when the caller supplies rows).
  if (input.cashiers && input.cashiers.length > 0) {
    rows.push(
      [],
      ["Sales by cashier", "Orders", "Net sales"],
      // `cashier` is a resolved user/staff name — user-controlled, sanitize it.
      ...input.cashiers.map((c) => [
        sanitizeTextCell(c.cashier),
        c.orderCount,
        amt(c.netSalesCents),
      ]),
    );
  }

  return rows.map(csvRow).join("\r\n");
}

export interface CsvReportMeta {
  /** Range label for the CSV title row (a single date or `"from – to"`). */
  rangeLabel: string;
  currency: string;
}

/** Shared title + currency preamble rows for a single-table CSV export. */
function csvPreamble(title: string, meta: CsvReportMeta): (string | number)[][] {
  return [[title, meta.rangeLabel], [`Amounts in ${meta.currency}`], []];
}

/**
 * Serialize the "Sales by item" table on its own (CRLF, RFC-4180). Item names
 * are user-controlled → sanitized against CSV formula injection; amount cells
 * stay raw decimals so a spreadsheet can sum them.
 */
export function buildItemSalesCsv(rows: ItemSalesRow[], meta: CsvReportMeta): string {
  const out: (string | number)[][] = [
    ...csvPreamble("VallaPOS — Sales by item", meta),
    ["Item", "Quantity", "Net sales", "Tax"],
    ...rows.map((i) => [
      sanitizeTextCell(i.name),
      i.quantity,
      centsToAmount(i.netSalesCents),
      centsToAmount(i.taxCents),
    ]),
  ];
  return out.map(csvRow).join("\r\n");
}

/** Serialize the "Sales by category" table on its own. */
export function buildCategorySalesCsv(rows: CategorySalesRow[], meta: CsvReportMeta): string {
  const out: (string | number)[][] = [
    ...csvPreamble("VallaPOS — Sales by category", meta),
    ["Category", "Quantity", "Net sales"],
    ...rows.map((c) => [sanitizeTextCell(c.category), c.quantity, centsToAmount(c.netSalesCents)]),
  ];
  return out.map(csvRow).join("\r\n");
}

/** Serialize the "Sales by cashier" (employee) table on its own. */
export function buildCashierSalesCsv(rows: CashierSalesRow[], meta: CsvReportMeta): string {
  const out: (string | number)[][] = [
    ...csvPreamble("VallaPOS — Sales by cashier", meta),
    ["Cashier", "Orders", "Net sales"],
    ...rows.map((c) => [sanitizeTextCell(c.cashier), c.orderCount, centsToAmount(c.netSalesCents)]),
  ];
  return out.map(csvRow).join("\r\n");
}
