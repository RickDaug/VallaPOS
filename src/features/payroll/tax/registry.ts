import "server-only";

import { isLocal } from "@/lib/edition";
import { createCheckGateway, isPayrollTaxConfigured } from "./tax-check";
import { FakePayrollTaxGateway } from "./tax-fake";
import type { PayrollTaxGateway } from "./gateway";

/**
 * Payroll-tax provider REGISTRY / SELECTOR — chooses the gateway by env + edition,
 * mirroring the intent of src/features/payments/registry.ts.
 *
 * Selection rules (docs/PAYROLL_TAX.md):
 *   - CHECK_API_KEY set        → the REAL Check gateway (live path).
 *   - unset, in a dev build    → the in-memory FAKE (lets you exercise the whole
 *                                pipeline locally with stand-in — NOT real — tax).
 *   - unset, in production/cloud→ DISABLED: no gateway is constructed, callers get
 *                                `null` and must degrade (dormant notice / 503).
 *
 * The Check gateway is NEVER constructed without a key (createCheckGateway would
 * throw on first call anyway) — this keeps the feature fully inert until keys land.
 */

export type GatewaySelection =
  | { available: true; source: "check" | "fake"; gateway: PayrollTaxGateway }
  | { available: false; source: "disabled"; gateway: null };

/** True in a non-production build where the fake stand-in is permitted. */
function fakeAllowed(): boolean {
  // Never fall back to the fake in the hosted cloud production build — a stand-in
  // that isn't real tax must not be reachable there. Local desktop + dev may use it.
  return isLocal || process.env.NODE_ENV !== "production";
}

/**
 * PROCESS-level dev fake. A single instance so state (created company/employees/
 * payroll) persists across requests within a running dev server — otherwise a
 * company created in one request wouldn't exist in the next. Unit tests do NOT
 * use this; they instantiate their own `new FakePayrollTaxGateway()`.
 */
let devFake: FakePayrollTaxGateway | null = null;
function sharedDevFake(): FakePayrollTaxGateway {
  return (devFake ??= new FakePayrollTaxGateway());
}

/**
 * Resolve the payroll-tax gateway for this deployment, or a disabled selection.
 */
export function selectPayrollTaxGateway(): GatewaySelection {
  if (isPayrollTaxConfigured()) {
    return { available: true, source: "check", gateway: createCheckGateway() };
  }
  if (fakeAllowed()) {
    return { available: true, source: "fake", gateway: sharedDevFake() };
  }
  return { available: false, source: "disabled", gateway: null };
}

/** True when a usable gateway exists for this deployment (live or dev-fake). */
export function isPayrollTaxAvailable(): boolean {
  return selectPayrollTaxGateway().available;
}
