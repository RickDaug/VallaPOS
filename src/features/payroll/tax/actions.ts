"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { requireSession, ForbiddenError } from "@/lib/tenant";
import { selectPayrollTaxGateway } from "./registry";
import { prismaPayrollTaxStore } from "./store";
import {
  startCompanyOnboarding,
  refreshOnboardingStatus,
  syncWorker,
  previewPayrollRun,
  approvePayrollRun,
  NOT_ONBOARDED,
  type PayrollCompanyState,
  type OnboardingView,
} from "./service";
import type { PayslipTaxSource } from "./mapping";
import {
  onboardingSchema,
  syncWorkerSchema,
  previewRunSchema,
  approveRunSchema,
} from "./schema";

/**
 * Server actions for the payroll-tax provider (docs/PAYROLL_TAX.md). Every action
 * is `manage_payroll`-gated and tenant-scoped by businessId. All provider I/O goes
 * through the gateway from the registry (the in-memory FAKE when no CHECK_* key,
 * in dev only; a disabled selection in prod). Mirrors connect-actions.ts.
 *
 * INERT by default: with PAYROLL_TAX_ENABLED off the settings UI never calls these
 * (it shows the dormant notice), and even if called they return `feature_disabled`
 * without touching a provider.
 */

const settingsPath = (businessId: string) => `/${businessId}/settings`;
const periodPath = (businessId: string, periodId: string) =>
  `/${businessId}/payroll/${periodId}`;

type Disabled = { ok: false; reason: "feature_disabled" };
const DISABLED: Disabled = { ok: false, reason: "feature_disabled" };

/** Load the business + assert the session may manage payroll here. */
async function loadPayrollBusiness(businessId: string) {
  const ctx = await requireCapability(businessId, "manage_payroll");
  const business = await db.business.findUnique({ where: { id: ctx.businessId } });
  if (!business) throw new ForbiddenError("NOT_A_MEMBER");
  return business;
}

function toCompanyState(business: {
  id: string;
  name: string;
  country: string;
  checkCompanyId: string | null;
}): PayrollCompanyState {
  return {
    businessId: business.id,
    legalName: business.name,
    country: business.country,
    checkCompanyId: business.checkCompanyId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant opt-in
// ─────────────────────────────────────────────────────────────────────────────

export type ToggleResult = { ok: true; enabled: boolean } | Disabled;

/** Opt this business in/out of the provider withholding path (Business.payrollTaxEnabled). */
export async function setPayrollTaxEnabled(input: unknown): Promise<ToggleResult> {
  const { businessId } = onboardingSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;

  const enabled = !business.payrollTaxEnabled;
  await db.business.update({ where: { id: business.id }, data: { payrollTaxEnabled: enabled } });
  revalidatePath(settingsPath(business.id));
  return { ok: true, enabled };
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding
// ─────────────────────────────────────────────────────────────────────────────

export type StartOnboardingResult =
  | { ok: true; onboardingUrl: string | null; status: string }
  | Disabled;

/** Begin (or resume) provider company onboarding; returns a hosted onboarding URL. */
export async function startPayrollTaxOnboarding(input: unknown): Promise<StartOnboardingResult> {
  const { businessId } = onboardingSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;

  const result = await startCompanyOnboarding({
    gateway: selection.gateway,
    store: prismaPayrollTaxStore(),
    company: toCompanyState(business),
    // Provider company contact = the signed-in owner (cloud). requireCapability
    // above already asserted an authenticated member; fall back defensively.
    contactEmail: (await safeOwnerEmail()) ?? "owner@vallapos.app",
  });

  revalidatePath(settingsPath(business.id));
  return { ok: true, onboardingUrl: result.onboardingUrl, status: result.status };
}

export type RefreshOnboardingResult = { ok: true; view: OnboardingView } | Disabled;

/** Force a live re-check of onboarding status from the provider and persist it. */
export async function refreshPayrollTaxOnboarding(
  input: unknown,
): Promise<RefreshOnboardingResult> {
  const { businessId } = onboardingSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;

  if (!business.checkCompanyId) return { ok: true, view: NOT_ONBOARDED };

  const view = await refreshOnboardingStatus({
    gateway: selection.gateway,
    store: prismaPayrollTaxStore(),
    company: toCompanyState(business),
  });
  revalidatePath(settingsPath(business.id));
  return { ok: true, view };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker sync
// ─────────────────────────────────────────────────────────────────────────────

export type SyncWorkerResult =
  | { ok: true; employeeId: string }
  | Disabled
  | { ok: false; reason: "not_onboarded" | "member_not_found" };

/** Sync one worker (Membership) to the provider, persisting the employee id. */
export async function syncPayrollTaxWorker(input: unknown): Promise<SyncWorkerResult> {
  const { businessId, membershipId } = syncWorkerSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;
  if (!business.checkCompanyId) return { ok: false, reason: "not_onboarded" };

  const member = await db.membership.findFirst({
    where: { id: membershipId, businessId },
    select: { id: true, name: true, checkEmployeeId: true, user: { select: { name: true, email: true } } },
  });
  if (!member) return { ok: false, reason: "member_not_found" };

  const { employeeId } = await syncWorker({
    gateway: selection.gateway,
    store: prismaPayrollTaxStore(),
    businessId,
    companyId: business.checkCompanyId,
    worker: {
      membershipId: member.id,
      checkEmployeeId: member.checkEmployeeId,
      name: member.user?.name ?? member.name ?? "Staff",
      email: member.user?.email ?? null,
    },
  });
  revalidatePath(settingsPath(businessId));
  return { ok: true, employeeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll: preview → approve
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewRunActionResult =
  | { ok: true; skipped: number; written: number }
  | Disabled
  | { ok: false; reason: "not_onboarded" | "period_not_found" | "no_payslips" };

/**
 * Run a provider tax PREVIEW for a pay period and mirror per-worker withholding +
 * net onto the payslips (never touching the pre-tax v1 `netCents`).
 */
export async function previewPayrollTaxRun(input: unknown): Promise<PreviewRunActionResult> {
  const { businessId, payPeriodId } = previewRunSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;
  if (!business.checkCompanyId) return { ok: false, reason: "not_onboarded" };

  const period = await db.payPeriod.findFirst({
    where: { id: payPeriodId, businessId },
    select: { id: true, endDate: true, checkPayrollId: true },
  });
  if (!period) return { ok: false, reason: "period_not_found" };

  const slips = await db.payslip.findMany({
    where: { businessId, payPeriodId },
    select: { id: true, membershipId: true, grossCents: true },
  });
  if (slips.length === 0) return { ok: false, reason: "no_payslips" };

  // Join each payslip's worker to their provider employee id (Payslip has no
  // membership relation, so resolve it via a scoped membership lookup).
  const members = await db.membership.findMany({
    where: { businessId },
    select: { id: true, checkEmployeeId: true },
  });
  const empByMember = new Map(members.map((m) => [m.id, m.checkEmployeeId]));

  const payslips: PayslipTaxSource[] = slips.map((s) => ({
    payslipId: s.id,
    checkEmployeeId: empByMember.get(s.membershipId) ?? null,
    grossCents: s.grossCents,
  }));

  // Payday = the period's inclusive last day (endDate is the exclusive window end).
  const payday = new Date(period.endDate.getTime() - 1).toISOString().slice(0, 10);

  const result = await previewPayrollRun({
    gateway: selection.gateway,
    store: prismaPayrollTaxStore(),
    businessId,
    companyId: business.checkCompanyId,
    payPeriodId,
    checkPayrollId: period.checkPayrollId,
    payday,
    payslips,
  });

  revalidatePath(periodPath(businessId, payPeriodId));
  return { ok: true, skipped: result.skipped, written: result.written.length };
}

export type ApproveRunActionResult =
  | { ok: true; status: string }
  | Disabled
  | { ok: false; reason: "not_previewed" | "period_not_found" };

/** Approve a previously-previewed provider run for a pay period. */
export async function approvePayrollTaxRun(input: unknown): Promise<ApproveRunActionResult> {
  const { businessId, payPeriodId } = approveRunSchema.parse(input);
  const business = await loadPayrollBusiness(businessId);

  const selection = selectPayrollTaxGateway();
  if (!selection.available) return DISABLED;
  if (!business.checkCompanyId) return { ok: false, reason: "not_previewed" };

  const period = await db.payPeriod.findFirst({
    where: { id: payPeriodId, businessId },
    select: { id: true, checkPayrollId: true },
  });
  if (!period) return { ok: false, reason: "period_not_found" };
  if (!period.checkPayrollId) return { ok: false, reason: "not_previewed" };

  const approval = await approvePayrollRun({
    gateway: selection.gateway,
    store: prismaPayrollTaxStore(),
    businessId,
    companyId: business.checkCompanyId,
    payPeriodId,
    checkPayrollId: period.checkPayrollId,
  });
  revalidatePath(periodPath(businessId, payPeriodId));
  return { ok: true, status: approval.status };
}

/** Best-effort owner email for the provider company contact (cloud only). */
async function safeOwnerEmail(): Promise<string | null> {
  try {
    const session = await requireSession();
    const email = (session as { user?: { email?: unknown } }).user?.email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}
