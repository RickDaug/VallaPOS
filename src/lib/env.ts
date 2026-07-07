import { z } from "zod";

/**
 * Validated environment. Fails fast at startup if anything is missing or
 * malformed, so we never half-boot a POS with a broken DB or auth config.
 */
// Optional enhancement vars: a misconfigured value must DEGRADE (auth falls back
// to per-instance in-memory rate limiting), never crash the whole app at boot.
// `.catch(undefined)` maps any invalid/blank value (e.g. an empty or malformed
// UPSTASH_REDIS_REST_URL pasted into Vercel) to undefined so the build/runtime
// can't be taken down by a misconfigured *optional* enhancement. We surface a
// warning below so a bad value isn't silently ignored.
const optionalUpstashUrl = z.string().url().optional().catch(undefined);
const optionalUpstashToken = z.string().min(1).optional().catch(undefined);

// Email-receipt provider (Resend). Both are OPTIONAL enhancements — when unset
// (or invalid) the receipt email action degrades to `email_not_configured` and
// the app/build keep working unchanged. `.catch(undefined)` mirrors the Upstash
// handling: a malformed value pasted into Vercel can never take down the build.
const optionalResendKey = z.string().min(1).optional().catch(undefined);
const optionalReceiptFrom = z.string().email().optional().catch(undefined);

// Integrated payments (Stripe Connect — PAYMENTS.md §9). ALL optional: when the
// secret key is unset the payments feature stays OFF (isPaymentsConfigured() is
// false) and the app/build behave exactly as before. `.catch(undefined)` mirrors
// the Upstash/Resend handling so a malformed value pasted into Vercel degrades to
// "off" instead of crashing the boot. The publishable key is NEXT_PUBLIC_* (safe
// to ship to the client); the secret + webhook secret never leave the server.
const optionalStripeSecret = z.string().min(1).optional().catch(undefined);
const optionalStripePublishable = z.string().min(1).optional().catch(undefined);
const optionalStripeWebhookSecret = z.string().min(1).optional().catch(undefined);

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  // Optional: Upstash Redis for Better Auth's shared rate-limit/session store.
  // When BOTH are set (and valid), auth uses Redis (persistent + shared across
  // Vercel instances); when unset or invalid, auth falls back to per-instance
  // in-memory limiting (see src/lib/redis.ts createSecondaryStorage).
  UPSTASH_REDIS_REST_URL: optionalUpstashUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalUpstashToken,
  // Optional: Resend email-receipts. RESEND_API_KEY enables sending; the
  // optional RECEIPT_FROM_EMAIL overrides the default sender address. Unset =
  // emailReceipt returns `email_not_configured` (see src/features/orders/email.ts).
  RESEND_API_KEY: optionalResendKey,
  RECEIPT_FROM_EMAIL: optionalReceiptFrom,
  // Optional: Stripe Connect integrated payments (PAYMENTS.md §9). Unset = the
  // payments feature is dormant (see src/features/payments/stripe.ts).
  STRIPE_SECRET_KEY: optionalStripeSecret,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalStripePublishable,
  STRIPE_WEBHOOK_SECRET: optionalStripeWebhookSecret,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment variables. See .env.example.");
}

export const env = parsed.data;

// A non-empty Upstash value that failed validation was silently dropped to
// undefined above (so the build doesn't die). Warn so the operator knows the
// shared rate limiter fell back to in-memory rather than the intended Redis.
if (
  (process.env.UPSTASH_REDIS_REST_URL && !env.UPSTASH_REDIS_REST_URL) ||
  (process.env.UPSTASH_REDIS_REST_TOKEN && !env.UPSTASH_REDIS_REST_TOKEN)
) {
  console.warn(
    "⚠ UPSTASH_REDIS_REST_URL/TOKEN is set but invalid — ignoring it and " +
      "falling back to per-instance in-memory rate limiting. Fix the value in " +
      "your environment to enable shared Redis-backed limiting.",
  );
}

// Same treatment for an invalid RECEIPT_FROM_EMAIL: dropped to undefined so the
// build survives, but warn so the operator knows the default sender will be used
// (or, if RESEND_API_KEY needs a verified sender, why sends may fail).
if (process.env.RECEIPT_FROM_EMAIL && !env.RECEIPT_FROM_EMAIL) {
  console.warn(
    "⚠ RECEIPT_FROM_EMAIL is set but is not a valid email — ignoring it and " +
      "falling back to the default sender address.",
  );
}
