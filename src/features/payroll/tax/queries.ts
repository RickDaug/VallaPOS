import "server-only";

import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { isPayrollTaxConfigured } from "./tax-check";
import { isPayrollTaxEnabled } from "./flags";
import { normalizeOnboardingStatus, type OnboardingStatus } from "./gateway";

/**
 * Read-side view for the Settings → Payroll Tax screen + the period-detail
 * provider display. Uses CACHED provider status columns (kept fresh by the
 * webhook + refresh action) so a render never blocks on a provider round-trip.
 * Membership-gated; the caller page additionally gates by `manage_payroll`.
 */
export interface PayrollTaxSettingsView {
  /** Platform flag on AND provider keys present (feature live at all). */
  configured: boolean;
  /** Platform kill-switch (PAYROLL_TAX_ENABLED). */
  flagEnabled: boolean;
  /** This business has opted in (Business.payrollTaxEnabled). */
  businessEnabled: boolean;
  /** This business has started onboarding (has a provider company). */
  connected: boolean;
  /** Normalized onboarding status. */
  status: OnboardingStatus;
}

export async function getPayrollTaxSettings(
  businessId: string,
): Promise<PayrollTaxSettingsView> {
  await requireMembership(businessId);
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      checkCompanyId: true,
      payrollTaxOnboardingStatus: true,
      payrollTaxEnabled: true,
    },
  });
  const flagEnabled = isPayrollTaxEnabled();
  return {
    configured: flagEnabled && isPayrollTaxConfigured(),
    flagEnabled,
    businessEnabled: Boolean(business?.payrollTaxEnabled),
    connected: Boolean(business?.checkCompanyId),
    status: normalizeOnboardingStatus(business?.payrollTaxOnboardingStatus),
  };
}

/**
 * Whether the provider withholding path should be REFLECTED in payroll screens
 * for this business: the platform flag is on AND the business has opted in. Kept
 * deliberately independent of key presence so the dev fake can be exercised; the
 * actions still gate provider CALLS on gateway availability.
 */
export interface PayrollTaxContext {
  /** Show provider withholding/net columns + the "provider computes tax" notice. */
  active: boolean;
}

export async function getPayrollTaxContext(businessId: string): Promise<PayrollTaxContext> {
  await requireMembership(businessId);
  if (!isPayrollTaxEnabled()) return { active: false };
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { payrollTaxEnabled: true },
  });
  return { active: Boolean(business?.payrollTaxEnabled) };
}
