/**
 * Phase 3 payments groundwork — FEATURE FLAG.
 *
 * ⚠ Gates any future use of the provider abstraction. DEFAULT OFF. While off,
 * the live checkout (`src/features/register/actions.ts`) is the ONLY money path;
 * the provider scaffold is import-safe but never invoked at runtime.
 *
 * We intentionally read `process.env` directly (not `@/lib/env`) so this stays a
 * pure, server-only-free module the registry tests can import. When integrated
 * payments graduate from groundwork, add `PAYMENTS_V2_ENABLED` to the zod schema
 * in `@/lib/env.ts` and switch this to read from there.
 */

/** True only when explicitly enabled. Anything but "true"/"1" is OFF. */
export function isPaymentsV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.PAYMENTS_V2_ENABLED;
  return v === "true" || v === "1";
}

/** Constant default — the flag ships OFF until a real integration is approved. */
export const PAYMENTS_V2_DEFAULT_ENABLED = false;
