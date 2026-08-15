import { describe, it, expect } from "vitest";
import {
  FakePayrollTaxGateway,
  fakeWithholding,
  FAKE_EMPLOYEE_TAX_BPS,
  FAKE_EMPLOYER_TAX_BPS,
} from "./tax-fake";

describe("fakeWithholding (STAND-IN — not real tax)", () => {
  it("applies the flat stand-in rates and nets gross − employee tax", () => {
    const w = fakeWithholding(100_000); // $1,000.00
    expect(w.employeeTaxCents).toBe(Math.round((100_000 * FAKE_EMPLOYEE_TAX_BPS) / 10_000));
    expect(w.employerTaxCents).toBe(Math.round((100_000 * FAKE_EMPLOYER_TAX_BPS) / 10_000));
    expect(w.netPayCents).toBe(100_000 - w.employeeTaxCents);
  });

  it("is deterministic and clamps negatives to zero gross", () => {
    expect(fakeWithholding(-5)).toEqual({ employeeTaxCents: 0, employerTaxCents: 0, netPayCents: 0 });
    expect(fakeWithholding(100_000)).toEqual(fakeWithholding(100_000));
  });
});

describe("FakePayrollTaxGateway", () => {
  it("creates a company that starts needing attention, with deterministic ids", async () => {
    const gw = new FakePayrollTaxGateway();
    const c1 = await gw.createCompany({ businessId: "biz_1", legalName: "Taquería", email: "o@x.test", country: "US" });
    expect(c1.companyId).toBe("com_fake_1");
    expect(c1.status).toBe("needs_attention");
    expect(c1.onboardingUrl).toContain("com_fake_1");

    const status = await gw.getOnboardingStatus(c1.companyId);
    expect(status.status).toBe("needs_attention");
    expect(status.remainingRequirements.length).toBeGreaterThan(0);
  });

  it("advances onboarding via the test helper", async () => {
    const gw = new FakePayrollTaxGateway();
    const c = await gw.createCompany({ businessId: "biz_1", legalName: "X", email: "o@x.test", country: "US" });
    gw.markCompanyStatus(c.companyId, "completed");
    const status = await gw.getOnboardingStatus(c.companyId);
    expect(status.status).toBe("completed");
    expect(status.remainingRequirements).toEqual([]);
  });

  it("upserts employees (create then reuse the passed id)", async () => {
    const gw = new FakePayrollTaxGateway();
    const created = await gw.upsertEmployee({ companyId: "com_1", membershipId: "m1", employeeId: null, name: "Ana", email: null });
    expect(created.employeeId).toMatch(/^emp_fake_/);
    const reused = await gw.upsertEmployee({ companyId: "com_1", membershipId: "m1", employeeId: created.employeeId, name: "Ana", email: null });
    expect(reused.employeeId).toBe(created.employeeId);
  });

  it("previews payroll with per-line withholding + totals, then approves", async () => {
    const gw = new FakePayrollTaxGateway();
    const preview = await gw.previewPayroll({
      companyId: "com_1",
      payrollId: null,
      payPeriodId: "pp_1",
      payday: "2026-07-15",
      lines: [
        { employeeId: "emp_1", grossCents: 100_000 },
        { employeeId: "emp_2", grossCents: 200_000 },
      ],
    });
    expect(preview.payrollId).toMatch(/^pay_fake_/);
    expect(preview.lines).toHaveLength(2);
    expect(preview.totals.grossCents).toBe(300_000);
    expect(preview.totals.netPayCents).toBe(
      preview.lines.reduce((s, l) => s + l.netPayCents, 0),
    );

    const approval = await gw.approvePayroll({ companyId: "com_1", payrollId: preview.payrollId });
    expect(approval.status).toBe("approved");
  });

  it("verifyWebhook parses a JSON body and parseEvent reduces it", async () => {
    const gw = new FakePayrollTaxGateway();
    const event = await gw.verifyWebhook(
      JSON.stringify({ type: "company.updated", data: { id: "com_9", status: "completed" } }),
    );
    expect(gw.parseEvent(event)).toEqual({ kind: "company", companyId: "com_9", status: "completed" });
  });
});
