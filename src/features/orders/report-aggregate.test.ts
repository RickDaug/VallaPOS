import { describe, it, expect } from "vitest";
import {
  aggregateItemSales,
  buildReportCsv,
  centsToAmount,
  csvField,
  sanitizeTextCell,
  type AggregateLineInput,
} from "@/features/orders/report-aggregate";

const line = (over: Partial<AggregateLineInput>): AggregateLineInput => ({
  nameSnapshot: "Burger",
  quantity: 1,
  totalCents: 1000,
  taxCents: 83,
  categoryName: "Food",
  ...over,
});

describe("aggregateItemSales", () => {
  it("sums quantity, net sales, and tax per item name", () => {
    const { byItem } = aggregateItemSales([
      line({ nameSnapshot: "Burger", quantity: 2, totalCents: 2000, taxCents: 165 }),
      line({ nameSnapshot: "Burger", quantity: 1, totalCents: 1000, taxCents: 83 }),
    ]);
    expect(byItem).toHaveLength(1);
    expect(byItem[0]).toEqual({ name: "Burger", quantity: 3, netSalesCents: 3000, taxCents: 248 });
  });

  it("groups by category and treats null category as Uncategorized", () => {
    const { byCategory } = aggregateItemSales([
      line({ nameSnapshot: "Burger", totalCents: 1000, categoryName: "Food" }),
      line({ nameSnapshot: "Fries", totalCents: 400, categoryName: "Food" }),
      line({ nameSnapshot: "Mystery", totalCents: 250, categoryName: null }),
    ]);
    const food = byCategory.find((c) => c.category === "Food");
    const uncat = byCategory.find((c) => c.category === "Uncategorized");
    expect(food).toEqual({ category: "Food", quantity: 2, netSalesCents: 1400 });
    expect(uncat).toEqual({ category: "Uncategorized", quantity: 1, netSalesCents: 250 });
  });

  it("sorts items by net sales descending, then name ascending", () => {
    const { byItem } = aggregateItemSales([
      line({ nameSnapshot: "Cheap", totalCents: 100 }),
      line({ nameSnapshot: "Pricey", totalCents: 900 }),
      line({ nameSnapshot: "AAA", totalCents: 100 }), // ties Cheap on net -> name breaks it
    ]);
    expect(byItem.map((i) => i.name)).toEqual(["Pricey", "AAA", "Cheap"]);
  });

  it("returns empty lists for no lines", () => {
    expect(aggregateItemSales([])).toEqual({ byItem: [], byCategory: [] });
  });
});

describe("centsToAmount", () => {
  it("formats cents as a two-decimal string", () => {
    expect(centsToAmount(0)).toBe("0.00");
    expect(centsToAmount(5)).toBe("0.05");
    expect(centsToAmount(1083)).toBe("10.83");
    expect(centsToAmount(-250)).toBe("-2.50");
  });
});

describe("csvField", () => {
  it("quotes and escapes fields with commas, quotes, or newlines", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(42)).toBe("42");
  });
});

describe("sanitizeTextCell", () => {
  it("prefixes a leading formula trigger with a single quote", () => {
    expect(sanitizeTextCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeTextCell("+1")).toBe("'+1");
    expect(sanitizeTextCell("-cmd")).toBe("'-cmd");
    expect(sanitizeTextCell("@foo")).toBe("'@foo");
    expect(sanitizeTextCell("\ttab")).toBe("'\ttab");
    expect(sanitizeTextCell("\rcarriage")).toBe("'\rcarriage");
  });

  it("leaves a normal name unchanged", () => {
    expect(sanitizeTextCell("Burger")).toBe("Burger");
    expect(sanitizeTextCell("Iced Tea")).toBe("Iced Tea");
  });
});

describe("buildReportCsv", () => {
  const csv = buildReportCsv({
    dateStr: "2026-06-14",
    currency: "USD",
    orderCount: 2,
    grossSalesCents: 3000,
    discountCents: 0,
    netSalesCents: 3000,
    taxCents: 248,
    tipCents: 100,
    refundsCents: 500,
    totalCollectedCents: 3348,
    byMethod: [{ method: "CASH", count: 2, amountCents: 3348 }],
    items: aggregateItemSales([
      line({ nameSnapshot: "Burger, Deluxe", quantity: 3, totalCents: 3000, taxCents: 248 }),
    ]),
  });

  it("includes a header, summary, payments, and both breakdowns", () => {
    expect(csv).toContain("VallaPOS sales report,2026-06-14");
    expect(csv).toContain("Net sales,30.00");
    expect(csv).toContain("Refunds,5.00");
    expect(csv).toContain("CASH,2,33.48");
    expect(csv).toContain("Sales by item,Quantity,Net sales,Tax");
    expect(csv).toContain("Sales by category,Quantity,Net sales");
  });

  it("escapes item names containing commas and uses CRLF rows", () => {
    expect(csv).toContain('"Burger, Deluxe",3,30.00,2.48');
    expect(csv).toContain("\r\n");
  });

  it("neutralizes CSV formula injection in user-controlled text cells", () => {
    const injected = buildReportCsv({
      dateStr: "2026-06-14",
      currency: "USD",
      orderCount: 1,
      grossSalesCents: 1000,
      discountCents: 0,
      netSalesCents: 1000,
      taxCents: 0,
      tipCents: 0,
      refundsCents: 0,
      totalCollectedCents: 1000,
      byMethod: [],
      items: aggregateItemSales([
        line({ nameSnapshot: "=SUM(A1)", categoryName: "@evil", totalCents: 1000, taxCents: 0 }),
      ]),
    });
    // Malicious item name and category are prefixed with a single quote.
    expect(injected).toContain("'=SUM(A1),1,10.00,0.00");
    expect(injected).toContain("'@evil,1,10.00");
  });

  it("does NOT alter negative amount cells (they must stay numeric for SUM)", () => {
    const refunded = buildReportCsv({
      dateStr: "2026-06-14",
      currency: "USD",
      orderCount: 1,
      grossSalesCents: -250,
      discountCents: 0,
      netSalesCents: -250,
      taxCents: 0,
      tipCents: 0,
      refundsCents: 0,
      totalCollectedCents: -250,
      byMethod: [],
      items: aggregateItemSales([
        line({ nameSnapshot: "Refund", categoryName: "Food", totalCents: -250, taxCents: 0 }),
      ]),
    });
    // A negative amount stays a bare "-2.50", never "'-2.50".
    expect(refunded).toContain("Net sales,-2.50");
    expect(refunded).toContain("Refund,1,-2.50,0.00");
    expect(refunded).not.toContain("'-2.50");
  });
});
