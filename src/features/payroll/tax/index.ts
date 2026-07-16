/**
 * Payroll-tax integration — public barrel (client-safe).
 *
 * ⚠ INERT SCAFFOLD, default OFF. Re-exports only the PURE modules (gateway port +
 * types, flags, reconcile, mapping). The server-only gateway/registry/store/
 * actions/queries are imported directly where needed so this barrel never pulls
 * `server-only` or the provider into a client bundle. See docs/PAYROLL_TAX.md.
 */

export * from "./gateway";
export * from "./reconcile";
export * from "./mapping";
export { isPayrollTaxEnabled, PAYROLL_TAX_DEFAULT_ENABLED } from "./flags";
export { FakePayrollTaxGateway, fakeWithholding, FAKE_EMPLOYEE_TAX_BPS, FAKE_EMPLOYER_TAX_BPS } from "./tax-fake";
