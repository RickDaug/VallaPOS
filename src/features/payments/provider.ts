/**
 * Phase 3 payments groundwork — the `PaymentProvider` ABSTRACTION.
 *
 * ⚠ INERT SCAFFOLD. No live checkout path imports this yet. A provider is the
 * uniform surface the register/tab flows will call instead of hard-coding cash
 * writes. Each concrete provider (cash, manual/QR, Stripe Terminal) implements
 * this; the registry/selector (`registry.ts`) picks one by method + runtime.
 *
 * Design intent: keep the methods minimal and processor-agnostic
 * (`createIntent` / `capture` / `cancel` / `status` / `refund`) so the live
 * checkout's "server recomputes totals, idempotent on clientUuid, writes
 * Order/OrderLine/Payment in one transaction" contract is preserved no matter
 * which provider settles the money. See `docs/PAYMENTS.md`.
 */

import type {
  CreateIntentInput,
  PaymentIntent,
  PaymentMethod,
  ProviderCapabilities,
  RefundResult,
} from "./types";

export interface PaymentProvider {
  /** Stable provider key, e.g. "cash", "manual", "stripe-terminal". */
  readonly id: string;
  /** The `Payment.method` rows this provider produces. */
  readonly method: PaymentMethod;
  /** Static capability flags used by the selector to filter by runtime. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Open a payment attempt. For cash this is a synthetic, already-captured
   * intent (no processor round-trip). For card/QR providers this calls the
   * processor and may return a `requires_action` intent with a `nextAction`.
   */
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;

  /**
   * Capture a previously-authorized intent. Cash/manual capture is a no-op
   * (already captured). Returns the settled intent.
   */
  capture(intentId: string): Promise<PaymentIntent>;

  /** Cancel/void an intent before it captures. */
  cancel(intentId: string): Promise<PaymentIntent>;

  /** Poll the current status (e.g. waiting on a QR scan or reader tap). */
  status(intentId: string): Promise<PaymentIntent>;

  /**
   * Refund a captured payment, full or partial. Cash refunds are recorded
   * locally (reversing negative Payment row, as the live refund flow already
   * does); card refunds go back through the processor.
   */
  refund(intentId: string, amountCents: number): Promise<RefundResult>;
}
