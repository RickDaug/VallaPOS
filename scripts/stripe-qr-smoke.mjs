/**
 * Live smoke test for the QR sale rail (PAYMENTS.md §9, PR-C).
 *
 * Creates a hosted Stripe Checkout Session ON A CONNECTED ACCOUNT — the EXACT
 * call `src/features/payments/checkout-stripe.ts` makes — and prints the URL, so
 * we confirm the Checkout shape (direct charge, dynamic payment methods, the
 * `qr-sale-…` idempotency key) against a real sandbox before shipping. The unit
 * tests cover the orchestration with a fake; THIS covers the wire format.
 *
 * Usage (needs a CLAIMED sandbox key with Connect access + a connected account id
 * that is charges-enabled — e.g. the one from scripts/stripe-connect-smoke.mjs):
 *
 *   STRIPE_SECRET_KEY=rk_test_... STRIPE_SMOKE_ACCOUNT=acct_... node scripts/stripe-qr-smoke.mjs
 *   # or point at a dotenv file:
 *   STRIPE_SMOKE_ACCOUNT=acct_... node --env-file=.env.local scripts/stripe-qr-smoke.mjs
 *
 * Prints the Checkout URL + a PASS/FAIL. Harmless in a sandbox. Never run against
 * a live key.
 */

const secret = process.env.STRIPE_SECRET_KEY;
const account = process.env.STRIPE_SMOKE_ACCOUNT;

if (!secret) {
  console.error("✗ STRIPE_SECRET_KEY is not set. Claim the sandbox, then export the key.");
  process.exit(2);
}
if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) {
  console.error("✗ Refusing to run against a LIVE key. Use a test/sandbox key.");
  process.exit(2);
}
if (!account || !account.startsWith("acct_")) {
  console.error(
    "✗ STRIPE_SMOKE_ACCOUNT is not set to a connected account id (acct_…). " +
      "Run scripts/stripe-connect-smoke.mjs first to create one.",
  );
  process.exit(2);
}

async function main() {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret);

  const clientUuid = `smoke-${Date.now()}`;
  const metadata = {
    businessId: "smoke_biz",
    orderId: "smoke_order",
    clientUuid,
    orderNumber: "1",
  };

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Order #1 (QR smoke)" },
              unit_amount: 1599,
            },
            quantity: 1,
          },
        ],
        success_url: "https://app.test/pay/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.test/smoke_biz/register?checkout=cancel",
        metadata,
        payment_intent_data: { metadata },
        // payment_method_types OMITTED → dynamic payment methods (country-agnostic).
      },
      {
        stripeAccount: account,
        idempotencyKey: `qr-sale-smoke_biz-${clientUuid}`,
      },
    );

    console.log("✓ created hosted Checkout Session on the connected account");
    console.log(`  id:        ${session.id}`);
    console.log(`  url:       ${session.url}`);
    console.log(`  expires:   ${session.expires_at}`);
    console.log(`  status:    ${session.status} / ${session.payment_status}`);
    console.log("\nPASS — QR sale Checkout wire format matches. Open the URL to pay in the sandbox.");
    process.exit(0);
  } catch (err) {
    console.error("✗ create Checkout Session failed:");
    console.error(`  ${err?.message ?? err}`);
    console.log("\nFAIL — QR sale Checkout wire format needs a fix (the port isolates it).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke script threw:", err);
  process.exit(1);
});
