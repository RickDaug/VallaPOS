/**
 * Flat SaaS subscription (PAYMENTS.md §9, PR-D) — public barrel.
 *
 * ⚠ Only the PURE, client-safe surface is re-exported here (gateway port + fake,
 * orchestration, webhook extractor, access resolution + gate flags, zod). The
 * server-only real gateway/store/queries and the "use server" actions are
 * imported DIRECTLY where needed so this barrel stays client-safe — same rule as
 * the payments barrel.
 *
 * DORMANT until configured + UNARMED until enforced: with the subscription env
 * unset, `isBillingConfigured()` is false (no UI) and `isBillingEnforced()` is
 * false (no block), so the app is byte-for-byte unchanged.
 */

export * from "./billing-gateway";
export * from "./billing-service";
export * from "./billing-webhook";
export * from "./billing-schema";
export {
  resolveSubscriptionAccess,
  isBillingConfigured,
  isBillingEnforced,
  type SubscriptionAccess,
} from "./subscription-access";
export { isBillingEnforceGateOn, BILLING_ENFORCE_GATE_DEFAULT } from "./flags";
