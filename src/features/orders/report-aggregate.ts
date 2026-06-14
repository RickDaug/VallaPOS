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
  items: ItemSalesReport;
}

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
    ["Sales by item", "Quantity", "Net sales", "Tax"],
    ...input.items.byItem.map((i) => [i.name, i.quantity, amt(i.netSalesCents), amt(i.taxCents)]),
    [],
    ["Sales by category", "Quantity", "Net sales"],
    ...input.items.byCategory.map((c) => [c.category, c.quantity, amt(c.netSalesCents)]),
  ];
  return rows.map(csvRow).join("\r\n");
}
