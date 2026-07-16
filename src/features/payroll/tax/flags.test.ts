import { describe, it, expect } from "vitest";
import { isPayrollTaxEnabled, PAYROLL_TAX_DEFAULT_ENABLED } from "./flags";

describe("isPayrollTaxEnabled", () => {
  it("defaults OFF and reads only true/1 as on", () => {
    expect(PAYROLL_TAX_DEFAULT_ENABLED).toBe(false);
    expect(isPayrollTaxEnabled({})).toBe(false);
    expect(isPayrollTaxEnabled({ PAYROLL_TAX_ENABLED: undefined })).toBe(false);
    expect(isPayrollTaxEnabled({ PAYROLL_TAX_ENABLED: "false" })).toBe(false);
    expect(isPayrollTaxEnabled({ PAYROLL_TAX_ENABLED: "yes" })).toBe(false);
    expect(isPayrollTaxEnabled({ PAYROLL_TAX_ENABLED: "true" })).toBe(true);
    expect(isPayrollTaxEnabled({ PAYROLL_TAX_ENABLED: "1" })).toBe(true);
  });
});
