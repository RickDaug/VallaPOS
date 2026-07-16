/**
 * Deterministic in-memory FAKE payroll-tax gateway.
 *
 * Mirrors FakeConnectGateway (src/features/payments/connect-gateway.ts): it makes
 * the WHOLE payroll-tax pipeline — company onboarding → employee sync → payroll
 * preview → payslip mirror populated → approve — unit-testable and dev-runnable
 * with NO provider keys. Ids are derived from a seq (not randomness) so tests
 * stay reproducible. The registry returns this in dev when CHECK_* is unset.
 *
 * ⚠⚠ THE WITHHOLDING CALC BELOW IS NOT REAL TAX ⚠⚠
 * It is a fixed flat-rate STAND-IN whose only job is to exercise the pipeline
 * end-to-end. It ignores jurisdiction, filing status, allowances, wage bases,
 * YTD caps, and every actual tax rule. It must NEVER be used to pay or file
 * anything — the real numbers come exclusively from the Check gateway. When
 * PAYROLL_TAX_ENABLED is on but CHECK_* is unset (dev only), any figures shown
 * are these fake ones, clearly labelled in the UI.
 */

import { parseProviderEvent } from "./reconcile";
import type {
  ApprovePayrollInput,
  CreateCompanyInput,
  OnboardingStatusResult,
  PayrollApproval,
  PayrollLineResult,
  PayrollPreview,
  PayrollTaxGateway,
  PreviewPayrollInput,
  ProviderCompany,
  ProviderEmployee,
  ProviderEvent,
  ProviderStatusUpdate,
  UpsertEmployeeInput,
} from "./gateway";

/** STAND-IN employee withholding rate — 18% flat. NOT a real tax rate. */
export const FAKE_EMPLOYEE_TAX_BPS = 1800;
/** STAND-IN employer-side tax rate — 7.65% flat (FICA-shaped). NOT a real rate. */
export const FAKE_EMPLOYER_TAX_BPS = 765;

/** Apply a bps rate to cents, rounded half-up to a whole cent. */
function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/** The three provider-sourced cent figures for one worker. */
export interface Withholding {
  employeeTaxCents: number;
  employerTaxCents: number;
  netPayCents: number;
}

/**
 * Compute the FAKE withholding for one line. Exported so tests (and the mapping
 * helpers) can assert the deterministic stand-in. NOT REAL TAX — see file header.
 */
export function fakeWithholding(grossCents: number): Withholding {
  const g = Math.max(0, Math.round(grossCents));
  const employeeTaxCents = applyBps(g, FAKE_EMPLOYEE_TAX_BPS);
  const employerTaxCents = applyBps(g, FAKE_EMPLOYER_TAX_BPS);
  return {
    employeeTaxCents,
    employerTaxCents,
    netPayCents: g - employeeTaxCents,
  };
}

interface FakeCompany {
  companyId: string;
  status: string;
}

export class FakePayrollTaxGateway implements PayrollTaxGateway {
  private seq = 0;
  readonly companies = new Map<string, FakeCompany>();
  readonly employees = new Set<string>();
  readonly payrolls = new Map<string, string>(); // payrollId -> status
  readonly createdCompanies: CreateCompanyInput[] = [];

  async createCompany(input: CreateCompanyInput): Promise<ProviderCompany> {
    this.createdCompanies.push(input);
    const companyId = `com_fake_${++this.seq}`;
    // New companies start with requirements outstanding (like the real flow).
    this.companies.set(companyId, { companyId, status: "needs_attention" });
    return {
      companyId,
      status: "needs_attention",
      onboardingUrl: `https://onboard.check.test/${companyId}`,
    };
  }

  async getOnboardingStatus(companyId: string): Promise<OnboardingStatusResult> {
    const company = this.companies.get(companyId);
    if (!company) throw new Error(`unknown company ${companyId}`);
    return {
      companyId,
      status: company.status,
      remainingRequirements:
        company.status === "completed" ? [] : ["Verify company details and bank account"],
    };
  }

  async upsertEmployee(input: UpsertEmployeeInput): Promise<ProviderEmployee> {
    const employeeId = input.employeeId ?? `emp_fake_${++this.seq}`;
    this.employees.add(employeeId);
    return { employeeId };
  }

  async previewPayroll(input: PreviewPayrollInput): Promise<PayrollPreview> {
    const payrollId = input.payrollId ?? `pay_fake_${++this.seq}`;
    this.payrolls.set(payrollId, "draft");

    const lines: PayrollLineResult[] = input.lines.map((line) => {
      const w = fakeWithholding(line.grossCents);
      return {
        employeeId: line.employeeId,
        grossCents: line.grossCents,
        employeeTaxCents: w.employeeTaxCents,
        employerTaxCents: w.employerTaxCents,
        netPayCents: w.netPayCents,
      };
    });

    const totals = lines.reduce(
      (acc, l) => ({
        grossCents: acc.grossCents + l.grossCents,
        employeeTaxCents: acc.employeeTaxCents + l.employeeTaxCents,
        employerTaxCents: acc.employerTaxCents + l.employerTaxCents,
        netPayCents: acc.netPayCents + l.netPayCents,
      }),
      { grossCents: 0, employeeTaxCents: 0, employerTaxCents: 0, netPayCents: 0 },
    );

    return { payrollId, status: "draft", lines, totals };
  }

  async approvePayroll(input: ApprovePayrollInput): Promise<PayrollApproval> {
    if (!this.payrolls.has(input.payrollId)) {
      throw new Error(`unknown payroll ${input.payrollId}`);
    }
    this.payrolls.set(input.payrollId, "approved");
    return { payrollId: input.payrollId, status: "approved" };
  }

  // The fake accepts the port's (rawBody, signature) shape but ignores the
  // signature — there is nothing to verify. Implemented with a single param
  // (TypeScript permits an implementation with fewer params than the interface).
  async verifyWebhook(rawBody: string): Promise<ProviderEvent> {
    // The fake accepts any body as a pre-parsed event (no signature to verify).
    const parsed = JSON.parse(rawBody) as { type?: string; object?: unknown; data?: unknown };
    return { type: parsed.type ?? "", object: parsed.object ?? parsed.data ?? parsed };
  }

  parseEvent(event: ProviderEvent): ProviderStatusUpdate | null {
    return parseProviderEvent(event);
  }

  // --- Test helpers (simulate the provider webhook advancing state) ----------

  /** Simulate onboarding finishing (or regressing). */
  markCompanyStatus(companyId: string, status: string): void {
    const company = this.companies.get(companyId);
    if (!company) throw new Error(`unknown company ${companyId}`);
    company.status = status;
  }
}
