/**
 * Payroll-tax integration — FEATURE FLAG.
 *
 * ⚠ Gates the automated-withholding path (embedded payroll provider). DEFAULT
 * OFF. While off, payroll v1 (gross / adjustments / pre-tax net + CSV export) is
 * the ONLY payroll behavior; the tax scaffold is import-safe but never invoked at
 * runtime, so behavior is byte-for-byte unchanged.
 *
 * Mirrors src/features/payments/flags.ts: we read `process.env` directly (not
 * `@/lib/env`) so this stays a pure, server-only-free module the registry/pipeline
 * tests can import. It is a PLATFORM-level kill switch; a given business ALSO
 * needs `Business.payrollTaxEnabled` true (per-tenant opt-in) before any provider
 * figures are shown for it.
 */

/** True only when explicitly enabled. Anything but "true"/"1" is OFF. */
export function isPayrollTaxEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.PAYROLL_TAX_ENABLED;
  return v === "true" || v === "1";
}

/** Constant default — the flag ships OFF until the integration is approved. */
export const PAYROLL_TAX_DEFAULT_ENABLED = false;
