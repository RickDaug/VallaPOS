/**
 * Phase 3 payments groundwork — provider REGISTRY + SELECTOR (pure).
 *
 * ⚠ INERT SCAFFOLD. Picks a provider by `PaymentMethod` and filters the catalog
 * by runtime capability (the browser PWA can't run native-only card readers).
 * Nothing here touches the DB or the live checkout; it's pure so it can be
 * unit-tested. See `docs/PAYMENTS.md`.
 *
 * Today only the cash provider is registered — it's the only live money rail and
 * the only one this groundwork PR implements. Manual/QR and Stripe Terminal
 * providers are designed in the doc and slot in here later behind the flag.
 */

import type { PaymentProvider } from "./provider";
import { cashProvider } from "./providers/cash";
import type { PaymentMethod, ProviderCapabilities, RuntimeTarget } from "./types";

/** All known providers, keyed by their stable id. Cash only, for now. */
const PROVIDERS: readonly PaymentProvider[] = [cashProvider];

/** Lookup by provider id (e.g. "cash"). Returns undefined if unknown. */
export function getProviderById(id: string): PaymentProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Lookup by payment method. If several share a method, the first wins. */
export function getProviderByMethod(method: PaymentMethod): PaymentProvider | undefined {
  return PROVIDERS.find((p) => p.method === method);
}

/**
 * True if a provider can run in the given runtime. A provider that
 * `requiresNativeShell` is unavailable on the "web" target (browser PWA) — this
 * is the load-bearing rule that keeps Tap-to-Pay/Bluetooth off the web build.
 */
export function isProviderAvailable(
  provider: PaymentProvider,
  runtime: RuntimeTarget,
): boolean {
  if (runtime === "web" && provider.capabilities.requiresNativeShell) {
    return false;
  }
  return true;
}

/** Every provider usable in this runtime (filters out native-only on web). */
export function availableProviders(runtime: RuntimeTarget): PaymentProvider[] {
  return PROVIDERS.filter((p) => isProviderAvailable(p, runtime));
}

/** True if ANY available provider advertises the given capability flag. */
export function runtimeSupports(
  runtime: RuntimeTarget,
  capability: keyof ProviderCapabilities,
): boolean {
  return availableProviders(runtime).some((p) => p.capabilities[capability]);
}

/**
 * Select the provider to settle a payment, given the chosen method and runtime.
 * Returns undefined when no registered provider can serve the method in this
 * runtime (e.g. a card-present method on the web target) — the caller decides
 * whether to fall back to cash or surface "unavailable here".
 */
export function selectProvider(
  method: PaymentMethod,
  runtime: RuntimeTarget,
): PaymentProvider | undefined {
  const provider = getProviderByMethod(method);
  if (!provider) return undefined;
  return isProviderAvailable(provider, runtime) ? provider : undefined;
}

/** Read-only view of the registered provider list (for diagnostics/UI). */
export function listProviders(): readonly PaymentProvider[] {
  return PROVIDERS;
}
