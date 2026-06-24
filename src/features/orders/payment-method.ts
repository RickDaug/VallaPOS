/**
 * Human-readable labels for the stored `PaymentMethod` enum values. Pure (no
 * `server-only`) so it's shared by the register, the printable receipt page, the
 * orders list, and the email renderer — one source of truth for how a method is
 * shown. `MANUAL` is surfaced as "Other": a payment taken outside the app
 * (external card reader, check, transfer) with no card data stored.
 */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  QR: "QR",
  MANUAL: "Other",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
