/**
 * Phase 3 payments groundwork — public barrel.
 *
 * ⚠ INERT SCAFFOLD. Re-exports the provider abstraction, registry/selector,
 * pure types, the cash reference provider, and the (default-OFF) feature flag.
 * Importing this does NOT change any checkout behavior. See `docs/PAYMENTS.md`.
 */

export * from "./types";
export type { PaymentProvider } from "./provider";
export {
  availableProviders,
  getProviderById,
  getProviderByMethod,
  isProviderAvailable,
  listProviders,
  runtimeSupports,
  selectProvider,
} from "./registry";
export { cashProvider } from "./providers/cash";
export { isPaymentsV2Enabled, PAYMENTS_V2_DEFAULT_ENABLED } from "./flags";

// Stripe Connect onboarding (PAYMENTS.md §9, PR-A). Only the PURE modules are
// re-exported here — the server-only gateway/store/actions/queries are imported
// directly where needed so this barrel stays client-safe.
export * from "./connect-gateway";
export * from "./connect-service";
export * from "./connect-webhook";
