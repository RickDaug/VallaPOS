import { describe, it, expect } from "vitest";
import { buildPayrollCsv, minutesToHours, type PayrollCsvSlip } from "./report";

const slip = (over: Partial<PayrollCsvSlip>): PayrollCsvSlip => ({
  nameSnapshot: "Alice",
  payType: "HOURLY",
  regularMinutes: 2400,
  overtimeMinutes: 60,
  regularPayCents: 80000,
  overtimePayCents: 3000,
  grossCents: 83000,
  additionsCents: 5000,
  deductionsCents: 2000,
  netCents: 86000,
  ...over,
});

describe("minutesToHours", () => {
  it("converts minutes to two-decimal hours", () => {
    expect(minutesToHours(90)).toBe("1.50");
    expect(minutesToHours(2400)).toBe("40.00");
    expect(minutesToHours(0)).toBe("0.00");
    expect(minutesToHours(-5)).toBe("0.00");
  });
});

describe("buildPayrollCsv", () => {
  it("uses CRLF line endings and includes the tax-boundary notice", () => {
    const csv = buildPayrollCsv({
      periodLabel: "Jul 1–15",
      currency: "USD",
      status: "FINALIZED",
      slips: [slip({})],
    });
    expect(csv).toContain("\r\n");
    expect(csv).toContain("NO tax withholding");
    expect(csv).toContain("VallaPOS pay run");
  });

  it("emits a row per worker and a totals row that sums money", () => {
    const csv = buildPayrollCsv({
      periodLabel: "Jul",
      currency: "USD",
      status: "DRAFT",
      slips: [slip({ nameSnapshot: "Alice" }), slip({ nameSnapshot: "Bob", netCents: 40000, grossCents: 40000, additionsCents: 0, deductionsCents: 0 })],
    });
    const lines = csv.split("\r\n");
    expect(lines.some((l) => l.startsWith("Alice,"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Bob,"))).toBe(true);
    // Total net = 86000 + 40000 = 126000 → 1260.00
    const totalLine = lines.find((l) => l.startsWith("Total,"));
    expect(totalLine).toContain("1260.00");
  });

  it("neutralizes CSV formula injection in the worker name", () => {
    const csv = buildPayrollCsv({
      periodLabel: "Jul",
      currency: "USD",
      status: "DRAFT",
      slips: [slip({ nameSnapshot: "=cmd|calc" })],
    });
    expect(csv).toContain("'=cmd|calc");
  });

  it("keeps amount cells raw so a spreadsheet can sum them", () => {
    const csv = buildPayrollCsv({
      periodLabel: "Jul",
      currency: "USD",
      status: "DRAFT",
      slips: [slip({ netCents: -2500, grossCents: -2500, additionsCents: 0, deductionsCents: 2500, regularPayCents: 0, overtimePayCents: 0 })],
    });
    // Negative net must stay a bare decimal, not quoted/text.
    expect(csv).toContain("-25.00");
  });
});
