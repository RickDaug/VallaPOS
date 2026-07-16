import { describe, it, expect } from "vitest";
import {
  toPayrollLines,
  unsyncedCount,
  applyPreviewToPayslips,
  type PayslipTaxSource,
} from "./mapping";
import type { PayrollPreview } from "./gateway";

const slips: PayslipTaxSource[] = [
  { payslipId: "ps_1", checkEmployeeId: "emp_1", grossCents: 100_000 },
  { payslipId: "ps_2", checkEmployeeId: null, grossCents: 50_000 }, // not synced
  { payslipId: "ps_3", checkEmployeeId: "emp_3", grossCents: 200_000 },
];

describe("toPayrollLines", () => {
  it("maps synced payslips to provider lines and skips unsynced workers", () => {
    expect(toPayrollLines(slips)).toEqual([
      { employeeId: "emp_1", grossCents: 100_000 },
      { employeeId: "emp_3", grossCents: 200_000 },
    ]);
  });

  it("counts unsynced workers", () => {
    expect(unsyncedCount(slips)).toBe(1);
    expect(unsyncedCount([])).toBe(0);
  });
});

describe("applyPreviewToPayslips", () => {
  const preview: PayrollPreview = {
    payrollId: "pay_1",
    status: "draft",
    lines: [
      { employeeId: "emp_1", grossCents: 100_000, employeeTaxCents: 18_000, employerTaxCents: 7_650, netPayCents: 82_000 },
      { employeeId: "emp_3", grossCents: 200_000, employeeTaxCents: 36_000, employerTaxCents: 15_300, netPayCents: 164_000 },
      { employeeId: "emp_ghost", grossCents: 1, employeeTaxCents: 0, employerTaxCents: 0, netPayCents: 1 },
    ],
    totals: { grossCents: 300_001, employeeTaxCents: 54_000, employerTaxCents: 22_950, netPayCents: 246_001 },
  };

  it("matches preview lines back onto payslips by employee id", () => {
    const figures = applyPreviewToPayslips(slips, preview);
    expect(figures).toEqual([
      { payslipId: "ps_1", providerPayslipId: "pay_1", employeeTaxCents: 18_000, employerTaxCents: 7_650, netPayCents: 82_000 },
      { payslipId: "ps_3", providerPayslipId: "pay_1", employeeTaxCents: 36_000, employerTaxCents: 15_300, netPayCents: 164_000 },
    ]);
  });

  it("omits unsynced payslips and preview lines with no matching payslip", () => {
    const figures = applyPreviewToPayslips(slips, preview);
    expect(figures.map((f) => f.payslipId)).not.toContain("ps_2"); // unsynced
    expect(figures).toHaveLength(2); // emp_ghost preview line ignored
  });
});
