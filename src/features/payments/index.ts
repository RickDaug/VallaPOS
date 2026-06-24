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
