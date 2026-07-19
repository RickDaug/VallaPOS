/**
 * Live smoke test for the flat SaaS subscription rail (PAYMENTS.md §9, PR-D).
 *
 * Creates a subscription Checkout Session on the PLATFORM account — the EXACT call
 * `src/features/billing/billing-stripe.ts` makes (mode:"subscription", the flat
 * Price, client_reference_id + subscription_data.metadata.businessId, the
 * `sub-checkout-…` idempotency key, NO stripeAccount) — and prints the URL, so we
 * confirm the wire format against a real sandbox before shipping. Then, if a
 * customer id is provided, opens a Customer Portal session too. The unit tests
 * cover the orchestration with a fake; THIS covers the wire format.
 *
 * Usage (needs a CLAIMED sandbox key + a flat-plan Price id in that sandbox):
 *
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_SUBSCRIPTION_PRICE_ID=price_... \
 *     node scripts/stripe-billing-smoke.mjs
 *   # optionally exercise the portal against an existing test customer:
 *   STRIPE_SMOKE_CUSTOMER=cus_... node --env-file=.env.local scripts/stripe-billing-smoke.mjs
 *
 * Prints the Checkout (+ optional Portal) URL + a PASS/FAIL. Harmless in a
 * sandbox. Never run against a live key.
 */

const secret = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID || process.env.STRIPE_SMOKE_PRICE;
const customer = process.env.STRIPE_SMOKE_CUSTOMER;

if (!secret) {
  console.error("✗ STRIPE_SECRET_KEY is not set. Claim the sandbox, then export the key.");
  process.exit(2);
}
if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) {
  console.error("✗ Refusing to run against a LIVE key. Use a test/sandbox key.");
  process.exit(2);
}
if (!priceId || !priceId.startsWith("price_")) {
  console.error(
    "✗ STRIPE_SUBSCRIPTION_PRICE_ID (or STRIPE_SMOKE_PRICE) is not set to a Price id " +
      "(price_…). Create a $19.99/mo recurring Price in the sandbox Dashboard first.",
  );
  process.exit(2);
}

async function main() {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret);

  const businessId = "smoke_biz";
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: "owner@valla.test",
        success_url: "https://app.test/smoke_biz/settings?billing=success",
        cancel_url: "https://app.test/smoke_biz/settings?billing=cancel",
        client_reference_id: businessId,
        subscription_data: { metadata: { businessId } },
        metadata: { businessId },
        // NO stripeAccount — this is the PLATFORM account (our subscription).
      },
      { idempotencyKey: `sub-checkout-${businessId}` },
    );

    console.log("✓ created subscription Checkout Session on the PLATFORM account");
    console.log(`  id:        ${session.id}`);
    console.log(`  url:       ${session.url}`);
    console.log(`  mode:      ${session.mode}`);
    console.log(`  status:    ${session.status} / ${session.payment_status}`);

    if (customer && customer.startsWith("cus_")) {
      const portal = await stripe.billingPortal.sessions.create({
        customer,
        return_url: "https://app.test/smoke_biz/settings?billing=portal",
      });
      console.log("\n✓ created Customer Portal session");
      console.log(`  url:       ${portal.url}`);
    } else {
      console.log(
        "\n(skip portal — set STRIPE_SMOKE_CUSTOMER=cus_… to also test the Customer Portal)",
      );
    }

    console.log(
      "\nPASS — subscription Checkout wire format matches. Open the URL to subscribe in the sandbox.",
    );
    process.exit(0);
  } catch (err) {
    console.error("✗ create subscription Checkout Session failed:");
    console.error(`  ${err?.message ?? err}`);
    console.log("\nFAIL — subscription wire format needs a fix (the port isolates it).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke script threw:", err);
  process.exit(1);
});
