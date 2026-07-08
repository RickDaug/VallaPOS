import { describe, it, expect } from "vitest";
import {
  aggregateItemSales,
  aggregateCashierSales,
  aggregateTenders,
  tenderVerification,
  buildReportCsv,
  buildItemSalesCsv,
  buildCategorySalesCsv,
  buildCashierSalesCsv,
  resolveReportRange,
  centsToAmount,
  csvField,
  sanitizeTextCell,
  type AggregateLineInput,
} from "@/features/orders/report-aggregate";
import { paymentMethodLabel } from "@/features/orders/payment-method";

const noTenders = aggregateTenders([]);

describe("aggregateCashierSales", () => {
  it("rolls orders up per cashier, sorted by net sales desc then name", () => {
    const rows = aggregateCashierSales([
      { cashier: "Ada", netSalesCents: 1000 },
      { cashier: "Bo", netSalesCents: 3000 },
      { cashier: "Ada", netSalesCents: 500 },
    ]);
    expect(rows).toEqual([
      { cashier: "Bo", orderCount: 1, netSalesCents: 3000 },
      { cashier: "Ada", orderCount: 2, netSalesCents: 1500 },
    ]);
  });

  it("returns an empty list for no orders", () => {
    expect(aggregateCashierSales([])).toEqual([]);
  });
});

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

describe("tenderVerification", () => {
  it("classifies CASH as verified and everything else as unverified", () => {
    expect(tenderVerification("CASH")).toBe("verified");
    expect(tenderVerification("QR")).toBe("unverified");
    expect(tenderVerification("MANUAL")).toBe("unverified");
    expect(tenderVerification("CARD")).toBe("unverified");
  });
});

describe("aggregateTenders", () => {
  it("rolls payments up per method with verified/unverified subtotals", () => {
    const b = aggregateTenders([
      { method: "CASH", amountCents: 1000 },
      { method: "CASH", amountCents: 500 },
      { method: "QR", amountCents: 2000 },
      { method: "MANUAL", amountCents: 300 },
    ]);
    expect(b.rows).toEqual([
      { method: "QR", count: 1, amountCents: 2000, verification: "unverified" },
      { method: "CASH", count: 2, amountCents: 1500, verification: "verified" },
      { method: "MANUAL", count: 1, amountCents: 300, verification: "unverified" },
    ]);
    expect(b.verifiedCollectedCents).toBe(1500); // CASH only
    expect(b.unverifiedCollectedCents).toBe(2300); // QR + MANUAL
  });

  it("nets negative refund reversals into the per-tender amounts and subtotals", () => {
    const b = aggregateTenders([
      { method: "QR", amountCents: 2000 },
      { method: "QR", amountCents: -500 }, // refund reversal on a QR sale
      { method: "CASH", amountCents: 1000 },
      { method: "CASH", amountCents: -1000 }, // cash refund
    ]);
    const qr = b.rows.find((r) => r.method === "QR")!;
    const cash = b.rows.find((r) => r.method === "CASH")!;
    expect(qr.amountCents).toBe(1500);
    expect(qr.count).toBe(2); // both movements counted
    expect(cash.amountCents).toBe(0);
    expect(b.verifiedCollectedCents).toBe(0); // net cash washed out by the refund
    expect(b.unverifiedCollectedCents).toBe(1500);
  });

  it("returns empty rows and zero subtotals for no payments", () => {
    expect(aggregateTenders([])).toEqual({
      rows: [],
      verifiedCollectedCents: 0,
      unverifiedCollectedCents: 0,
    });
  });
});

describe("resolveReportRange", () => {
  it("defaults both bounds to today for missing/blank params", () => {
    expect(resolveReportRange(undefined, undefined, "2026-07-08")).toEqual({
      fromStr: "2026-07-08",
      toStr: "2026-07-08",
      label: "2026-07-08",
    });
  });

  it("falls back to today for shape-invalid values", () => {
    expect(resolveReportRange("nope", "07/08/2026", "2026-07-08")).toEqual({
      fromStr: "2026-07-08",
      toStr: "2026-07-08",
      label: "2026-07-08",
    });
  });

  it("labels a multi-day range with an en dash", () => {
    const r = resolveReportRange("2026-07-01", "2026-07-08", "2026-07-08");
    expect(r).toEqual({
      fromStr: "2026-07-01",
      toStr: "2026-07-08",
      label: "2026-07-01 – 2026-07-08",
    });
  });

  it("swaps an inverted range so from <= to", () => {
    const r = resolveReportRange("2026-07-08", "2026-07-01", "2026-07-08");
    expect(r.fromStr).toBe("2026-07-01");
    expect(r.toStr).toBe("2026-07-08");
  });
});

describe("per-table CSV builders", () => {
  const meta = { rangeLabel: "2026-07-01 – 2026-07-08", currency: "USD" };

  it("buildItemSalesCsv emits a title, header, and sanitized rows", () => {
    const csv = buildItemSalesCsv(
      [
        { name: "Burger, Deluxe", quantity: 3, netSalesCents: 3000, taxCents: 248 },
        { name: "=evil", quantity: 1, netSalesCents: 100, taxCents: 0 },
      ],
      meta,
    );
    expect(csv).toContain("VallaPOS — Sales by item,2026-07-01 – 2026-07-08");
    expect(csv).toContain("Amounts in USD");
    expect(csv).toContain("Item,Quantity,Net sales,Tax");
    expect(csv).toContain('"Burger, Deluxe",3,30.00,2.48');
    expect(csv).toContain("'=evil,1,1.00,0.00"); // formula-injection neutralized
    expect(csv).toContain("\r\n");
  });

  it("buildCategorySalesCsv emits category rows", () => {
    const csv = buildCategorySalesCsv([{ category: "Food", quantity: 4, netSalesCents: 3400 }], meta);
    expect(csv).toContain("VallaPOS — Sales by category,2026-07-01 – 2026-07-08");
    expect(csv).toContain("Category,Quantity,Net sales");
    expect(csv).toContain("Food,4,34.00");
  });

  it("buildCashierSalesCsv emits cashier rows and sanitizes names", () => {
    const csv = buildCashierSalesCsv(
      [
        { cashier: "Ada", orderCount: 2, netSalesCents: 1500 },
        { cashier: "@bad", orderCount: 1, netSalesCents: 500 },
      ],
      meta,
    );
    expect(csv).toContain("VallaPOS — Sales by cashier,2026-07-01 – 2026-07-08");
    expect(csv).toContain("Cashier,Orders,Net sales");
    expect(csv).toContain("Ada,2,15.00");
    expect(csv).toContain("'@bad,1,5.00");
  });
});

describe("buildReportCsv cashier section", () => {
  const base = {
    dateStr: "2026-07-08",
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
    tenders: noTenders,
    methodLabel: paymentMethodLabel,
    items: aggregateItemSales([]),
  };

  it("appends a Sales by cashier section when cashiers are supplied", () => {
    const csv = buildReportCsv({
      ...base,
      cashiers: [{ cashier: "Ada", orderCount: 2, netSalesCents: 1500 }],
    });
    expect(csv).toContain("Sales by cashier,Orders,Net sales");
    expect(csv).toContain("Ada,2,15.00");
  });

  it("omits the cashier section when none are supplied", () => {
    expect(buildReportCsv(base)).not.toContain("Sales by cashier");
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
    tenders: aggregateTenders([
      { method: "CASH", amountCents: 1848 },
      { method: "QR", amountCents: 1000 },
      { method: "MANUAL", amountCents: 500 },
    ]),
    methodLabel: paymentMethodLabel,
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

  it("includes a Payments-by-tender audit section with verification labels and subtotals", () => {
    expect(csv).toContain("Payments by tender,Count,Amount,Verification");
    // The note cell contains a comma, so RFC-4180 quotes it. QR is the highest
    // amount; MANUAL surfaces as "Other".
    const note = '"Unverified — operator-confirmed, no drawer/PSP evidence"';
    expect(csv).toContain(`QR,1,10.00,${note}`);
    expect(csv).toContain("Cash,1,18.48,Verified (in-drawer)");
    expect(csv).toContain(`Other,1,5.00,${note}`);
    expect(csv).toContain("Verified collected (in-drawer),,18.48");
    expect(csv).toContain("Unverified collected (operator-confirmed),,15.00");
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
      tenders: noTenders,
      methodLabel: paymentMethodLabel,
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
      tenders: noTenders,
      methodLabel: paymentMethodLabel,
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
