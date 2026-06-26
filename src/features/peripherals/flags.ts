/**
 * Peripherals groundwork — FEATURE FLAG.
 *
 * ⚠ Gates any future use of the device-manager abstraction. DEFAULT OFF. While
 * off, the app talks to NO peripheral hardware; the scaffold is import-safe but
 * never invoked at runtime (real WebUSB/Bluetooth transports are Phase 1).
 *
 * We intentionally read `process.env` directly (not `@/lib/env`) so this stays a
 * pure, server-only-free module the registry tests can import. When peripherals
 * graduate from groundwork, add `PERIPHERALS_V2_ENABLED` to the zod schema in
 * `@/lib/env.ts` and switch this to read from there. Mirrors `payments/flags.ts`.
 */

/** True only when explicitly enabled. Anything but "true"/"1" is OFF. */
export function isPeripheralsV2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.PERIPHERALS_V2_ENABLED;
  return v === "true" || v === "1";
}

/** Constant default — the flag ships OFF until real transports are approved. */
export const PERIPHERALS_V2_DEFAULT_ENABLED = false;
