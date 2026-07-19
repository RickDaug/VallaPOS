/**
 * Flat SaaS subscription (PAYMENTS.md §9, PR-D) — the ENFORCEMENT FEATURE FLAG.
 *
 * ⚠ This is the CRITICAL SAFETY SEAM. Configuring billing (so owners CAN
 * subscribe) is separate from ENFORCING it (hard-blocking unsubscribed tenants).
 * `BILLING_ENFORCE_GATE` arms the hard block; while OFF, no tenant is ever locked
 * out no matter how the subscription env is configured. DEFAULT OFF.
 *
 * We intentionally read `process.env` directly (not `@/lib/env`) so this stays a
 * pure, server-only-free module the tests can import — mirroring
 * `src/features/payments/flags.ts` (`isPaymentsV2Enabled`).
 */

/** True only when the enforcement gate is explicitly armed. Anything but
 *  "true"/"1" is OFF (so an unset or typo'd value can never lock anyone out). */
export function isBillingEnforceGateOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.BILLING_ENFORCE_GATE;
  return v === "true" || v === "1";
}

/** Constant default — the enforcement gate ships OFF (unarmed). */
export const BILLING_ENFORCE_GATE_DEFAULT = false;
