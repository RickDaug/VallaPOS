/**
 * Phase 3 payments groundwork — CASH provider.
 *
 * ⚠ INERT SCAFFOLD. This DESCRIBES the current cash behavior through the
 * provider interface; it does NOT replace the live cash checkout in
 * `src/features/register/actions.ts`. Cash needs no processor: an intent is
 * synthetic and already "captured" the moment it's created (the customer hands
 * over money). Change is computed exactly as the live action does
 * (`changeCents = tendered - total`).
 *
 * When the register migrates onto providers, this is the reference cash impl —
 * it must keep producing the same `Payment{ method: CASH, status: CAPTURED,
 * tenderedCents, changeCents }` row the live transaction writes today.
 */

import type { PaymentProvider } from "../provider";
import type {
  CreateIntentInput,
  PaymentIntent,
  ProviderCapabilities,
  RefundResult,
} from "../types";

const CASH_CAPABILITIES: ProviderCapabilities = {
  supportsCardNotPresent: false,
  supportsCardPresent: false,
  supportsQr: false,
  supportsRefund: true, // recorded locally as a reversing negative Payment row
  supportsPartialCapture: true, // cash can take any amount; partial refunds exist
  requiresNativeShell: false, // works everywhere, including the browser PWA
};

/** Synthetic intent id so cash has a stable handle without a processor. */
function cashIntentId(clientUuid: string): string {
  return `cash_${clientUuid}`;
}

export const cashProvider: PaymentProvider = {
  id: "cash",
  method: "CASH",
  capabilities: CASH_CAPABILITIES,

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    const tendered = input.cashTenderedCents ?? input.amount.amountCents;
    if (tendered < input.amount.amountCents) {
      // Mirrors the live action's "Cash tendered is less than the total." guard.
      throw new Error("Cash tendered is less than the total.");
    }
    return {
      intentId: cashIntentId(input.clientUuid),
      method: "CASH",
      status: "captured", // cash captures immediately — no processor round-trip
      amount: input.amount,
      processorRef: null,
      changeCents: tendered - input.amount.amountCents,
      nextAction: { type: "none" },
    };
  },

  async capture(intentId: string): Promise<PaymentIntent> {
    // Cash is already captured at intent creation; capture is a no-op echo.
    return {
      intentId,
      method: "CASH",
      status: "captured",
      amount: { amountCents: 0, currency: "USD" },
      processorRef: null,
      nextAction: { type: "none" },
    };
  },

  async cancel(intentId: string): Promise<PaymentIntent> {
    return {
      intentId,
      method: "CASH",
      status: "canceled",
      amount: { amountCents: 0, currency: "USD" },
      processorRef: null,
      nextAction: { type: "none" },
    };
  },

  async status(intentId: string): Promise<PaymentIntent> {
    // No processor to poll; a cash intent is terminal the moment it's created.
    return {
      intentId,
      method: "CASH",
      status: "captured",
      amount: { amountCents: 0, currency: "USD" },
      processorRef: null,
      nextAction: { type: "none" },
    };
  },

  async refund(intentId: string, amountCents: number): Promise<RefundResult> {
    // The live refund flow records a reversing NEGATIVE Payment row; here we just
    // describe that outcome. No processor call.
    return {
      refundId: `${intentId}_refund`,
      status: "refunded",
      amountCents,
      processorRef: null,
    };
  },
};
