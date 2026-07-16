/**
 * Payroll-tax ORCHESTRATION — pure, side-effect-free except through the injected
 * `PayrollTaxGateway` (provider) and `PayrollTaxStore` (persistence). No DB, no
 * SDK, no `server-only` import, so `service.test.ts` drives the whole pipeline
 * (onboarding → employee sync → payroll preview → payslip mirror → approve) with
 * the FakePayrollTaxGateway + an in-memory store. Mirrors connect-service.ts.
 *
 * VallaPOS computes hours + gross and orchestrates; the provider computes tax/net
 * and files/remits. Nothing here stores PII — only opaque provider ids + cents.
 */

import {
  normalizeOnboardingStatus,
  type OnboardingStatus,
  type PayrollPreview,
  type PayrollTaxGateway,
} from "./gateway";
import {
  applyPreviewToPayslips,
  toPayrollLines,
  unsyncedCount,
  type PayslipTaxFigures,
  type PayslipTaxSource,
} from "./mapping";

// ─────────────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────────────

/** The business fields the orchestration reads. */
export interface PayrollCompanyState {
  businessId: string;
  legalName: string;
  country: string;
  /** Existing provider company id, or null if never created. */
  checkCompanyId: string | null;
}

/** Persistence port — the action supplies a Prisma-backed implementation. */
export interface PayrollTaxStore {
  /** Persist the newly created provider company id + its status on the business. */
  saveCompany(businessId: string, companyId: string, status: string): Promise<void>;
  /** Persist a refreshed onboarding status. Includes companyId (defense in depth). */
  saveOnboardingStatus(businessId: string, companyId: string, status: string): Promise<void>;
  /** Persist a worker's provider employee id on their membership. */
  saveEmployeeId(businessId: string, membershipId: string, employeeId: string): Promise<void>;
  /** Persist a payroll run's provider id + status on the pay period. */
  savePayrollRun(
    businessId: string,
    payPeriodId: string,
    payrollId: string,
    status: string,
  ): Promise<void>;
  /** Persist provider tax/net mirror figures onto payslips (bulk). */
  savePayslipFigures(businessId: string, figures: PayslipTaxFigures[]): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding
// ─────────────────────────────────────────────────────────────────────────────

export interface StartOnboardingInput {
  gateway: PayrollTaxGateway;
  store: PayrollTaxStore;
  company: PayrollCompanyState;
  contactEmail: string;
}

export interface StartOnboardingResult {
  companyId: string;
  onboardingUrl: string | null;
  status: OnboardingStatus;
  /** True when this call created the company (vs. reusing an existing one). */
  created: boolean;
}

/**
 * Begin (or resume) onboarding. Reuses an existing `checkCompanyId` so a repeat
 * click never spawns a second company; a fresh business gets one created and its
 * id persisted BEFORE the URL is returned, so a crash after creation can resume.
 */
export async function startCompanyOnboarding(
  input: StartOnboardingInput,
): Promise<StartOnboardingResult> {
  const { gateway, store, company, contactEmail } = input;

  if (company.checkCompanyId) {
    const status = await gateway.getOnboardingStatus(company.checkCompanyId);
    await store.saveOnboardingStatus(company.businessId, status.companyId, status.status);
    return {
      companyId: status.companyId,
      onboardingUrl: null,
      status: normalizeOnboardingStatus(status.status),
      created: false,
    };
  }

  const created = await gateway.createCompany({
    businessId: company.businessId,
    legalName: company.legalName,
    email: contactEmail,
    country: company.country,
  });
  await store.saveCompany(company.businessId, created.companyId, created.status);
  return {
    companyId: created.companyId,
    onboardingUrl: created.onboardingUrl,
    status: normalizeOnboardingStatus(created.status),
    created: true,
  };
}

export interface OnboardingView {
  connected: boolean;
  companyId: string | null;
  status: OnboardingStatus;
  remainingRequirements: string[];
}

export const NOT_ONBOARDED: OnboardingView = {
  connected: false,
  companyId: null,
  status: "not_started",
  remainingRequirements: [],
};

/**
 * Live-reconcile onboarding status from the provider and persist it. A business
 * with no company short-circuits to NOT_ONBOARDED without a network call.
 */
export async function refreshOnboardingStatus(input: {
  gateway: PayrollTaxGateway;
  store: PayrollTaxStore;
  company: PayrollCompanyState;
}): Promise<OnboardingView> {
  const { gateway, store, company } = input;
  if (!company.checkCompanyId) return NOT_ONBOARDED;

  const result = await gateway.getOnboardingStatus(company.checkCompanyId);
  await store.saveOnboardingStatus(company.businessId, result.companyId, result.status);
  return {
    connected: true,
    companyId: result.companyId,
    status: normalizeOnboardingStatus(result.status),
    remainingRequirements: result.remainingRequirements,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker sync
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerSyncInput {
  gateway: PayrollTaxGateway;
  store: PayrollTaxStore;
  businessId: string;
  companyId: string;
  worker: {
    membershipId: string;
    checkEmployeeId: string | null;
    name: string;
    email: string | null;
  };
}

/** Create/update the worker at the provider and persist the returned employee id. */
export async function syncWorker(input: WorkerSyncInput): Promise<{ employeeId: string }> {
  const { gateway, store, businessId, companyId, worker } = input;
  const employee = await gateway.upsertEmployee({
    companyId,
    membershipId: worker.membershipId,
    employeeId: worker.checkEmployeeId,
    name: worker.name,
    email: worker.email,
  });
  await store.saveEmployeeId(businessId, worker.membershipId, employee.employeeId);
  return { employeeId: employee.employeeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll: preview → approve
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewRunInput {
  gateway: PayrollTaxGateway;
  store: PayrollTaxStore;
  businessId: string;
  companyId: string;
  payPeriodId: string;
  /** Existing provider payroll id when re-previewing, else null. */
  checkPayrollId: string | null;
  payday: string;
  payslips: PayslipTaxSource[];
}

export interface PreviewRunResult {
  preview: PayrollPreview;
  /** Payslips written with mirror figures. */
  written: PayslipTaxFigures[];
  /** Workers skipped because they aren't synced to the provider yet. */
  skipped: number;
}

/**
 * Run a provider tax PREVIEW for a pay period and MIRROR the per-worker
 * withholding + net back onto the payslips (never touching the v1 `netCents`).
 * Persists the provider payroll id + status on the period.
 */
export async function previewPayrollRun(input: PreviewRunInput): Promise<PreviewRunResult> {
  const { gateway, store, businessId, companyId, payPeriodId, checkPayrollId, payday, payslips } =
    input;

  const lines = toPayrollLines(payslips);
  const skipped = unsyncedCount(payslips);

  const preview = await gateway.previewPayroll({
    companyId,
    payrollId: checkPayrollId,
    payPeriodId,
    payday,
    lines,
  });

  const written = applyPreviewToPayslips(payslips, preview);
  await store.savePayslipFigures(businessId, written);
  await store.savePayrollRun(businessId, payPeriodId, preview.payrollId, preview.status);

  return { preview, written, skipped };
}

export interface ApproveRunInput {
  gateway: PayrollTaxGateway;
  store: PayrollTaxStore;
  businessId: string;
  companyId: string;
  payPeriodId: string;
  checkPayrollId: string;
}

/** Approve a previously-previewed provider payroll run and persist its status. */
export async function approvePayrollRun(
  input: ApproveRunInput,
): Promise<{ payrollId: string; status: string }> {
  const { gateway, store, businessId, companyId, payPeriodId, checkPayrollId } = input;
  const approval = await gateway.approvePayroll({ companyId, payrollId: checkPayrollId });
  await store.savePayrollRun(businessId, payPeriodId, approval.payrollId, approval.status);
  return approval;
}
