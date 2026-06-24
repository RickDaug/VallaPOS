/**
 * Phase 3 payments groundwork — PURE TYPES.
 *
 * ⚠ INERT SCAFFOLD. Nothing in `src/features/payments/` is wired into the live
 * checkout path yet. This is a parallel structure we will migrate the register
 * onto once a real payment integration is decision-gated and approved. See
 * `docs/PAYMENTS.md` for the design and the open decisions.
 *
 * Money is INTEGER CENTS everywhere (mirrors `@/lib/money`). No floats.
 *
 * Kept free of `server-only` / Prisma imports so the registry/selector and
 * capability logic can be unit-tested and reused without dragging server
 * modules into the bundle.
 */

import type { PaymentMethod } from "@prisma/client";

export type { PaymentMethod };

/**
 * What a provider can do. The register uses these to decide which providers to
 * offer in a given runtime (e.g. card-present readers need a native shell the
 * browser PWA doesn't have, so they're filtered out on the web).
 */
export interface ProviderCapabilities {
  /** Customer-not-present card entry (e.g. a hosted Stripe Payment Link). */
  supportsCardNotPresent: boolean;
  /** Card-present via a physical reader (Stripe Terminal / Tap to Pay). */
  supportsCardPresent: boolean;
  /** QR / payment-link rails (Stripe Payment Link QR, or a regional QR rail). */
  supportsQr: boolean;
  /** Refunds can be issued back through this provider programmatically. */
  supportsRefund: boolean;
  /** Partial-amount captures/refunds are supported. */
  supportsPartialCapture: boolean;
  /**
   * Requires a native app shell (Bluetooth/USB readers, Tap to Pay). The browser
   * PWA can NOT satisfy this — such providers are unavailable on the web target.
   */
  requiresNativeShell: boolean;
}

/** The surface a provider runs in. The browser PWA can't do native-only rails. */
export type RuntimeTarget = "web" | "native";

/** Lifecycle of a payment attempt, provider-agnostic. */
export type PaymentIntentStatus =
  | "requires_action" // awaiting customer action (tap card, scan QR, hand cash)
  | "processing" // submitted to the processor, not yet final
  | "captured" // funds captured (terminal success)
  | "canceled" // intent voided before capture
  | "failed"; // processor declined / errored

/**
 * Server-authoritative amount for a payment attempt. The CALLER never sends a
 * total the provider trusts — these cents come from the same server-side
 * `computePricedOrder` the live checkout already uses. Carried here so the
 * provider abstraction is self-contained.
 */
export interface PaymentAmount {
  /** Total to collect, integer cents (incl. tax + tip per the order totals). */
  amountCents: number;
  /** ISO-4217 currency, e.g. "USD". Matches `Business.currency`. */
  currency: string;
}

/** Input to open a payment intent. Identifiers are opaque to the provider. */
export interface CreateIntentInput {
  businessId: string;
  /** The order this intent settles (may be created before or alongside it). */
  orderId?: string;
  /** Client idempotency key — the same UUID the offline queue already mints. */
  clientUuid: string;
  amount: PaymentAmount;
  /** Cash only: amount handed over, for change computation. */
  cashTenderedCents?: number;
}

/** The provider's view of an in-flight or settled payment. */
export interface PaymentIntent {
  /** Provider-local intent id (cash uses a synthetic local id). */
  intentId: string;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  amount: PaymentAmount;
  /** Processor reference (e.g. Stripe PaymentIntent id) — null for cash/manual. */
  processorRef: string | null;
  /** Cash only: change due, integer cents. */
  changeCents?: number;
  /** Non-sensitive card metadata only (FACTA/PCI): brand + last4, never PAN. */
  cardBrand?: string | null;
  cardLast4?: string | null;
  /** Anything the UI needs to drive the next step (e.g. a QR/redirect URL). */
  nextAction?: ProviderNextAction;
}

/** What the UI must surface to advance a `requires_action` intent. */
export type ProviderNextAction =
  | { type: "none" }
  | { type: "display_qr"; url: string }
  | { type: "redirect"; url: string }
  | { type: "use_reader"; readerId: string }
  | { type: "collect_cash"; amountCents: number };

/** Result of a refund request against a settled payment. */
export interface RefundResult {
  refundId: string;
  status: "refunded" | "pending" | "failed";
  amountCents: number;
  processorRef: string | null;
}
