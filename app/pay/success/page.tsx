import type { Metadata } from "next";

/**
 * Customer-facing "payment received" landing (PAYMENTS.md §9, PR-C). This is the
 * `success_url` Stripe redirects the CUSTOMER's phone to after they pay the QR
 * Checkout Session. It is deliberately minimal and PUBLIC (no auth, no tenant
 * data): the sale is settled by the WEBHOOK, not by anyone reaching this page, so
 * it makes no claims and touches no data — it just tells the customer to hand the
 * phone back. The cashier's register learns of the capture by polling the webhook-
 * settled CheckoutSession, independently of this redirect.
 */

export const metadata: Metadata = {
  title: "Payment received — VallaPOS",
  robots: { index: false, follow: false },
};

export default function PaymentSuccessPage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h1 className="mt-6 text-2xl font-black">Payment received</h1>
      <p className="mt-2 text-muted-foreground">
        Thanks! Your payment went through. Please hand the phone back to the cashier —
        your receipt will be finalized at the register.
      </p>
    </main>
  );
}
