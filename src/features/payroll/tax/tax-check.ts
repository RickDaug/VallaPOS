import "server-only";

import { env } from "@/lib/env";
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

/**
 * REAL Check payroll-tax gateway (docs/PAYROLL_TAX.md) — the ONLY module that
 * talks to Check over the network. Implements the `PayrollTaxGateway` port with
 * direct `fetch` calls (no SDK dependency — mirrors connect-stripe.ts), so we add
 * NO new dependency.
 *
 * DORMANT by default: everything degrades to "off" when CHECK_API_KEY is unset —
 * see `isPayrollTaxConfigured()`. Constructing the gateway without a key throws,
 * so callers must gate on that flag first (the registry does). Nothing here is
 * reachable in production until real keys are set.
 *
 * ⚠ LIVE-VERIFY: Check's exact request/response shapes are documented against
 * their API but MUST be confirmed against a real Check SANDBOX before this ships.
 * Each endpoint below is structured cleanly with a `TODO(check-sandbox)` where the
 * precise field name / path needs their live docs. The port isolates any shape
 * fix to this file — the orchestration, actions, UI, and tests are unaffected.
 *
 * Compliance: VallaPOS is the software platform / integrator. Check is the payroll
 * provider that computes tax, files, and remits; the MERCHANT is employer of
 * record. See docs/PAYROLL_TAX.md §compliance.
 */

/** Check API base by environment. */
const CHECK_API_BASE: Record<"sandbox" | "production", string> = {
  // TODO(check-sandbox): confirm the exact hostnames from Check's live docs.
  sandbox: "https://sandbox.checkhq.com",
  production: "https://api.checkhq.com",
};

/**
 * True when the payroll-tax provider is configured. Requires the API key; the
 * webhook secret is required to TRUST inbound webhooks (verifyWebhook throws
 * without it) but its absence doesn't hide the onboarding CTA, matching how the
 * feature can be exercised outbound-only during setup.
 */
export function isPayrollTaxConfigured(): boolean {
  return Boolean(env.CHECK_API_KEY);
}

export class CheckGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "CheckGatewayError";
  }
}

function requireApiKey(): string {
  const key = env.CHECK_API_KEY;
  if (!key) throw new CheckGatewayError("CHECK_API_KEY is not configured", 500);
  return key;
}

function apiBase(): string {
  return CHECK_API_BASE[env.CHECK_ENV === "production" ? "production" : "sandbox"];
}

interface CheckRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Dedupes retried writes (e.g. a double-clicked "Run preview"). */
  idempotencyKey?: string;
}

async function checkFetch<T>(req: CheckRequest): Promise<T> {
  const key = requireApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  // TODO(check-sandbox): confirm Check's idempotency header name.
  if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

  const res = await fetch(`${apiBase()}${req.path}`, {
    method: req.method,
    headers,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    const message = typeof err.message === "string" ? err.message : `Check error ${res.status}`;
    throw new CheckGatewayError(message, res.status, res.headers.get("x-request-id") ?? undefined);
  }
  return json as T;
}

// --- Response shapes (partial) + parsing ------------------------------------
// TODO(check-sandbox): these mirror Check's documented shapes but the exact field
// names/paths must be confirmed against a live sandbox response.

interface CheckCompanyResponse {
  id?: unknown;
  status?: unknown;
  onboard?: { url?: unknown; status?: unknown; remaining_steps?: unknown };
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseCompany(json: CheckCompanyResponse): ProviderCompany {
  const companyId = str(json.id);
  if (!companyId) throw new CheckGatewayError("Check company response missing id", 502);
  return {
    companyId,
    status: str(json.status) || str(json.onboard?.status) || "needs_attention",
    onboardingUrl: typeof json.onboard?.url === "string" ? json.onboard.url : null,
  };
}

// --- The gateway ------------------------------------------------------------

export function createCheckGateway(): PayrollTaxGateway {
  return {
    async createCompany(input: CreateCompanyInput): Promise<ProviderCompany> {
      // TODO(check-sandbox): confirm the create-company endpoint + body schema.
      const json = await checkFetch<CheckCompanyResponse>({
        method: "POST",
        path: "/v1/companies",
        idempotencyKey: `payroll-company-create-${input.businessId}`,
        body: {
          legal_name: input.legalName,
          email: input.email,
          // NO SSN/EIN/bank here — collected by Check's own hosted onboarding.
          metadata: { businessId: input.businessId },
        },
      });
      return parseCompany(json);
    },

    async getOnboardingStatus(companyId: string): Promise<OnboardingStatusResult> {
      const json = await checkFetch<CheckCompanyResponse>({
        method: "GET",
        path: `/v1/companies/${encodeURIComponent(companyId)}`,
      });
      const company = parseCompany(json);
      const remaining = json.onboard?.remaining_steps;
      return {
        companyId: company.companyId,
        status: company.status,
        remainingRequirements: Array.isArray(remaining) ? remaining.map((r) => str(r)) : [],
      };
    },

    async upsertEmployee(input: UpsertEmployeeInput): Promise<ProviderEmployee> {
      // TODO(check-sandbox): confirm employee create/update endpoints + schema.
      // The provider's hosted flow collects SSN/bank; we send only non-sensitive
      // identity + our metadata for reconciliation.
      const body = {
        company: input.companyId,
        first_name: input.name,
        email: input.email ?? undefined,
        metadata: { membershipId: input.membershipId },
      };
      const json = input.employeeId
        ? await checkFetch<{ id?: unknown }>({
            method: "POST",
            path: `/v1/employees/${encodeURIComponent(input.employeeId)}`,
            body,
          })
        : await checkFetch<{ id?: unknown }>({
            method: "POST",
            path: "/v1/employees",
            idempotencyKey: `payroll-employee-create-${input.membershipId}`,
            body,
          });
      const employeeId = str(json.id) || input.employeeId || "";
      if (!employeeId) throw new CheckGatewayError("Check employee response missing id", 502);
      return { employeeId };
    },

    async previewPayroll(input: PreviewPayrollInput): Promise<PayrollPreview> {
      // TODO(check-sandbox): confirm the payroll create + preview/calculate flow.
      // Check's model is create-payroll → add items → calculate; the exact
      // endpoints/fields must be verified. We map our per-worker gross onto items
      // and read back the provider-computed tax/net.
      const json = await checkFetch<CheckPayrollResponse>({
        method: "POST",
        path: input.payrollId
          ? `/v1/payrolls/${encodeURIComponent(input.payrollId)}/preview`
          : "/v1/payrolls/preview",
        idempotencyKey: input.payrollId ? undefined : `payroll-preview-${input.payPeriodId}`,
        body: {
          company: input.companyId,
          payday: input.payday,
          metadata: { payPeriodId: input.payPeriodId },
          items: input.lines.map((l) => ({
            employee: l.employeeId,
            earnings: [{ type: "gross", amount_cents: l.grossCents }],
          })),
        },
      });
      return parsePayroll(json);
    },

    async approvePayroll(input: ApprovePayrollInput): Promise<PayrollApproval> {
      // TODO(check-sandbox): confirm the approve/submit endpoint.
      const json = await checkFetch<CheckPayrollResponse>({
        method: "POST",
        path: `/v1/payrolls/${encodeURIComponent(input.payrollId)}/approve`,
        idempotencyKey: `payroll-approve-${input.payrollId}`,
        body: { company: input.companyId },
      });
      return { payrollId: str(json.id) || input.payrollId, status: str(json.status) || "approved" };
    },

    async verifyWebhook(_rawBody: string, signature: string | null): Promise<ProviderEvent> {
      const secret = env.CHECK_WEBHOOK_SECRET;
      if (!secret) throw new CheckGatewayError("CHECK_WEBHOOK_SECRET is not configured", 500);
      if (!signature) throw new CheckGatewayError("missing webhook signature", 400);
      // TODO(check-sandbox): implement Check's exact signature scheme (likely an
      // HMAC-SHA256 over the raw body compared against a signature header). Until
      // the scheme is confirmed we FAIL CLOSED — reject rather than trust an
      // unverified body — so no unsigned event can mutate state. Use node:crypto
      // (already available) for the HMAC; no new dependency needed.
      throw new CheckGatewayError(
        "Check webhook verification is not implemented yet (LIVE-VERIFY the signature scheme)",
        501,
      );
    },

    parseEvent(event: ProviderEvent): ProviderStatusUpdate | null {
      return parseProviderEvent(event);
    },
  };
}

interface CheckPayrollResponse {
  id?: unknown;
  status?: unknown;
  items?: Array<{
    employee?: unknown;
    gross_cents?: unknown;
    employee_taxes_cents?: unknown;
    employer_taxes_cents?: unknown;
    net_pay_cents?: unknown;
  }>;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function parsePayroll(json: CheckPayrollResponse): PayrollPreview {
  const payrollId = str(json.id);
  if (!payrollId) throw new CheckGatewayError("Check payroll response missing id", 502);
  const lines: PayrollLineResult[] = (json.items ?? []).map((it) => ({
    employeeId: str(it.employee),
    grossCents: num(it.gross_cents),
    employeeTaxCents: num(it.employee_taxes_cents),
    employerTaxCents: num(it.employer_taxes_cents),
    netPayCents: num(it.net_pay_cents),
  }));
  const totals = lines.reduce(
    (acc, l) => ({
      grossCents: acc.grossCents + l.grossCents,
      employeeTaxCents: acc.employeeTaxCents + l.employeeTaxCents,
      employerTaxCents: acc.employerTaxCents + l.employerTaxCents,
      netPayCents: acc.netPayCents + l.netPayCents,
    }),
    { grossCents: 0, employeeTaxCents: 0, employerTaxCents: 0, netPayCents: 0 },
  );
  return { payrollId, status: str(json.status) || "draft", lines, totals };
}
