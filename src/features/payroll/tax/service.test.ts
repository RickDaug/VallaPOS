import { describe, it, expect } from "vitest";
import { FakePayrollTaxGateway, fakeWithholding } from "./tax-fake";
import {
  startCompanyOnboarding,
  refreshOnboardingStatus,
  syncWorker,
  previewPayrollRun,
  approvePayrollRun,
  NOT_ONBOARDED,
  type PayrollTaxStore,
  type PayrollCompanyState,
} from "./service";
import type { PayslipTaxFigures } from "./mapping";

/**
 * In-memory PayrollTaxStore that records writes for assertions — mirrors the
 * connect-service.test memStore. The whole onboarding → sync → preview → approve
 * pipeline runs with NO DB and NO provider keys.
 */
function memStore() {
  const state = {
    companyId: null as string | null,
    onboardingStatus: null as string | null,
    employeeIds: new Map<string, string>(),
    payrollByPeriod: new Map<string, { payrollId: string; status: string }>(),
    figures: new Map<string, PayslipTaxFigures>(),
  };
  const store: PayrollTaxStore = {
    async saveCompany(_b, companyId, status) {
      state.companyId = companyId;
      state.onboardingStatus = status;
    },
    async saveOnboardingStatus(_b, _c, status) {
      state.onboardingStatus = status;
    },
    async saveEmployeeId(_b, membershipId, employeeId) {
      state.employeeIds.set(membershipId, employeeId);
    },
    async savePayrollRun(_b, payPeriodId, payrollId, status) {
      state.payrollByPeriod.set(payPeriodId, { payrollId, status });
    },
    async savePayslipFigures(_b, figures) {
      for (const f of figures) state.figures.set(f.payslipId, f);
    },
  };
  return { store, state };
}

function company(overrides: Partial<PayrollCompanyState> = {}): PayrollCompanyState {
  return {
    businessId: "biz_1",
    legalName: "Taquería Valla",
    country: "US",
    checkCompanyId: null,
    ...overrides,
  };
}

describe("payroll-tax pipeline (fake gateway + in-memory store)", () => {
  it("onboards a company on first start and persists its id + status", async () => {
    const gateway = new FakePayrollTaxGateway();
    const { store, state } = memStore();

    const result = await startCompanyOnboarding({
      gateway,
      store,
      company: company(),
      contactEmail: "owner@valla.test",
    });

    expect(result.created).toBe(true);
    expect(result.companyId).toBe("com_fake_1");
    expect(result.status).toBe("needs_attention");
    expect(state.companyId).toBe("com_fake_1");
    expect(gateway.createdCompanies).toEqual([
      { businessId: "biz_1", legalName: "Taquería Valla", email: "owner@valla.test", country: "US" },
    ]);
  });

  it("reuses an existing company (no second company on repeat start)", async () => {
    const gateway = new FakePayrollTaxGateway();
    const { store } = memStore();
    const existing = await gateway.createCompany({ businessId: "biz_1", legalName: "X", email: "o@x.test", country: "US" });

    const result = await startCompanyOnboarding({
      gateway,
      store,
      company: company({ checkCompanyId: existing.companyId }),
      contactEmail: "owner@valla.test",
    });

    expect(result.created).toBe(false);
    expect(result.companyId).toBe(existing.companyId);
    expect(gateway.createdCompanies).toHaveLength(1); // no new company
  });

  it("refresh short-circuits to NOT_ONBOARDED without a call when no company", async () => {
    const gateway = new FakePayrollTaxGateway();
    const { store } = memStore();
    const view = await refreshOnboardingStatus({ gateway, store, company: company({ checkCompanyId: null }) });
    expect(view).toEqual(NOT_ONBOARDED);
  });

  it("runs the full pipeline: onboard → sync → preview mirrors figures → approve", async () => {
    const gateway = new FakePayrollTaxGateway();
    const { store, state } = memStore();

    // 1. Onboard + complete.
    const onboard = await startCompanyOnboarding({ gateway, store, company: company(), contactEmail: "o@x.test" });
    const companyId = onboard.companyId;
    gateway.markCompanyStatus(companyId, "completed");
    const refreshed = await refreshOnboardingStatus({
      gateway,
      store,
      company: company({ checkCompanyId: companyId }),
    });
    expect(refreshed.status).toBe("completed");
    expect(state.onboardingStatus).toBe("completed");

    // 2. Sync two workers.
    const e1 = await syncWorker({
      gateway, store, businessId: "biz_1", companyId,
      worker: { membershipId: "m1", checkEmployeeId: null, name: "Ana", email: "ana@x.test" },
    });
    const e2 = await syncWorker({
      gateway, store, businessId: "biz_1", companyId,
      worker: { membershipId: "m2", checkEmployeeId: null, name: "Bob", email: null },
    });
    expect(state.employeeIds.get("m1")).toBe(e1.employeeId);
    expect(state.employeeIds.get("m2")).toBe(e2.employeeId);

    // 3. Preview — one synced worker, one NOT synced (should be skipped).
    const payslips = [
      { payslipId: "ps_1", checkEmployeeId: e1.employeeId, grossCents: 100_000 },
      { payslipId: "ps_2", checkEmployeeId: e2.employeeId, grossCents: 200_000 },
      { payslipId: "ps_3", checkEmployeeId: null, grossCents: 50_000 },
    ];
    const preview = await previewPayrollRun({
      gateway, store, businessId: "biz_1", companyId,
      payPeriodId: "pp_1", checkPayrollId: null, payday: "2026-07-15", payslips,
    });

    expect(preview.skipped).toBe(1);
    expect(preview.written).toHaveLength(2);
    // The v1 gross is untouched; the mirror carries provider withholding + net.
    const f1 = state.figures.get("ps_1")!;
    const expected1 = fakeWithholding(100_000);
    expect(f1.employeeTaxCents).toBe(expected1.employeeTaxCents);
    expect(f1.netPayCents).toBe(expected1.netPayCents);
    expect(f1.providerPayslipId).toBe(preview.preview.payrollId);
    expect(state.figures.has("ps_3")).toBe(false); // unsynced never written
    // The run id + status were persisted on the period.
    expect(state.payrollByPeriod.get("pp_1")?.payrollId).toBe(preview.preview.payrollId);

    // 4. Approve.
    const approval = await approvePayrollRun({
      gateway, store, businessId: "biz_1", companyId,
      payPeriodId: "pp_1", checkPayrollId: preview.preview.payrollId,
    });
    expect(approval.status).toBe("approved");
    expect(state.payrollByPeriod.get("pp_1")?.status).toBe("approved");
  });
});
