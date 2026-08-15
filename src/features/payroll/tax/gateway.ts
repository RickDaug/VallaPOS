/**
 * Payroll-tax provider gateway PORT (docs/PAYROLL_TAX.md).
 *
 * This is the ONE narrow interface the payroll-tax orchestration depends on —
 * never a provider SDK directly. It mirrors the Stripe Connect `ConnectGateway`
 * port exactly (src/features/payments/connect-gateway.ts): the register/settings
 * flow talks to the port, the in-memory FAKE (tax-fake.ts) makes the whole
 * pipeline unit-testable with no keys, and the ONLY module that touches the real
 * provider over the network is tax-check.ts.
 *
 * DIVISION OF LABOR (docs/PAYROLL_TAX.md): VallaPOS computes hours + gross and
 * ORCHESTRATES the run; the embedded payroll provider (Check) computes statutory
 * tax withholding + net, files, and remits; the merchant is employer of record.
 *
 * PII BOUNDARY: no SSN / bank numbers ever cross this port or land in our DB —
 * they live only in the provider, tokenized. We pass/hold opaque provider ids
 * (company / employee / payroll) and integer-cent figures only.
 *
 * No `import "server-only"` and no SDK import here, so tests and node tooling can
 * import it freely.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding status (normalized)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Our NORMALIZED onboarding status. The raw provider status string is mirrored
 * onto `Business.payrollTaxOnboardingStatus`; `normalizeOnboardingStatus` maps it
 * into this small closed set the UI can reason about.
 *   - not_started     no company created yet
 *   - needs_attention company exists but outstanding requirements block payroll
 *   - in_review       requirements submitted; the provider is verifying
 *   - completed       fully onboarded — the company may run payroll
 *   - blocked         the provider rejected / suspended the company
 */
export type OnboardingStatus =
  | "not_started"
  | "needs_attention"
  | "in_review"
  | "completed"
  | "blocked";

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  "not_started",
  "needs_attention",
  "in_review",
  "completed",
  "blocked",
] as const;

/**
 * Map a raw provider status string into our normalized status. Defaults to
 * `needs_attention` for an unrecognized non-empty status (safe: never claims
 * "completed" without proof), and `not_started` for null/empty.
 */
export function normalizeOnboardingStatus(raw: string | null | undefined): OnboardingStatus {
  if (!raw) return "not_started";
  switch (raw) {
    // Check-style company onboarding statuses (docs/PAYROLL_TAX.md §provider).
    case "completed":
    case "onboarded":
      return "completed";
    case "in_review":
    case "processing":
      return "in_review";
    case "blocked":
    case "suspended":
    case "rejected":
      return "blocked";
    case "needs_attention":
    case "requirements_due":
    case "provisioned":
      return "needs_attention";
    default:
      return "needs_attention";
  }
}

/** True once the company is fully onboarded and may run payroll. */
export function canRunPayroll(status: OnboardingStatus): boolean {
  return status === "completed";
}

// ─────────────────────────────────────────────────────────────────────────────
// Company
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCompanyInput {
  /** Our tenant id — echoed into provider metadata for reconciliation. */
  businessId: string;
  legalName: string;
  email: string;
  /** ISO-3166 alpha-2, uppercased. Payroll tax is US-only at launch. */
  country: string;
}

/** The provider company handle + its current onboarding state. */
export interface ProviderCompany {
  companyId: string;
  /** Raw provider status string (mirrored to the DB verbatim). */
  status: string;
  /** Hosted onboarding URL when the provider offers one, else null. */
  onboardingUrl: string | null;
}

export interface OnboardingStatusResult {
  companyId: string;
  status: string;
  /** Human-readable outstanding requirements, if the provider reports them. */
  remainingRequirements: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertEmployeeInput {
  companyId: string;
  /** Our worker id (Membership) — echoed into provider metadata. */
  membershipId: string;
  /** Existing provider employee id when re-syncing, else null to create. */
  employeeId: string | null;
  name: string;
  email: string | null;
}

/**
 * The provider employee handle. NOTE: SSN / bank details are collected by the
 * provider's own hosted flow (self-onboarding) — they are NEVER passed through
 * this port, so nothing sensitive lands in our DB.
 */
export interface ProviderEmployee {
  employeeId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll: preview → approve
// ─────────────────────────────────────────────────────────────────────────────

/** One worker's gross for a run — keyed by the provider employee id. */
export interface PayrollLineInput {
  employeeId: string;
  grossCents: number;
}

export interface PreviewPayrollInput {
  companyId: string;
  /** Existing provider payroll id when re-previewing, else null to create. */
  payrollId: string | null;
  /** Our pay-period id — echoed into provider metadata. */
  payPeriodId: string;
  /** ISO YYYY-MM-DD payday, used by the provider for tax tables. */
  payday: string;
  lines: PayrollLineInput[];
}

/** Provider-computed withholding for one worker. All integer cents. */
export interface PayrollLineResult {
  employeeId: string;
  grossCents: number;
  /** Employee statutory withholding (federal/state/FICA employee side). */
  employeeTaxCents: number;
  /** Employer-side tax (employer's cost — not withheld from the worker). */
  employerTaxCents: number;
  /** Take-home net after withholding = gross − employeeTax. */
  netPayCents: number;
}

export interface PayrollPreview {
  payrollId: string;
  status: string;
  lines: PayrollLineResult[];
  totals: {
    grossCents: number;
    employeeTaxCents: number;
    employerTaxCents: number;
    netPayCents: number;
  };
}

export interface ApprovePayrollInput {
  companyId: string;
  payrollId: string;
}

export interface PayrollApproval {
  payrollId: string;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

/** A verified provider event, reduced to the fields the route needs. */
export interface ProviderEvent {
  type: string;
  object: unknown;
}

/**
 * A reconciled status update extracted from an event — either a company
 * onboarding transition or a payroll-run transition. `parseEvent` returns null
 * for anything we don't act on.
 */
export type ProviderStatusUpdate =
  | { kind: "company"; companyId: string; status: string }
  | { kind: "payroll"; payrollId: string; status: string };

// ─────────────────────────────────────────────────────────────────────────────
// The port
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollTaxGateway {
  createCompany(input: CreateCompanyInput): Promise<ProviderCompany>;
  getOnboardingStatus(companyId: string): Promise<OnboardingStatusResult>;
  upsertEmployee(input: UpsertEmployeeInput): Promise<ProviderEmployee>;
  previewPayroll(input: PreviewPayrollInput): Promise<PayrollPreview>;
  approvePayroll(input: ApprovePayrollInput): Promise<PayrollApproval>;
  /** Verify a webhook signature and return the parsed event, or throw. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<ProviderEvent>;
  /** PURE reduction of an event to a status update (null = ignore). */
  parseEvent(event: ProviderEvent): ProviderStatusUpdate | null;
}
