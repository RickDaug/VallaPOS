import { z } from "zod";
import { isLocal } from "@/lib/edition";

/**
 * Validated environment. Fails fast at startup if anything is missing or
 * malformed, so we never half-boot a POS with a broken DB or auth config.
 *
 * EDITION BRANCH (docs/EDITIONS.md §4): the CLOUD-only vars (Neon `DATABASE_URL`,
 * Better Auth secret/URL, the app URL) are REQUIRED in the cloud build but not in
 * the LOCAL (offline desktop) build — it has no Neon, no Better Auth, and no
 * hosted origin. In the local branch each collapses to a harmless `.default()`
 * placeholder so (a) the app boots on a machine that never set them and (b) the
 * inferred `env` TYPE stays `string` for every field — so the cloud consumers
 * (`auth.ts`, `tenant.ts`, …) compile and behave BYTE-FOR-BYTE unchanged. When
 * `isLocal` is false (the default) the schema is exactly the strict cloud one.
 */

/** In the cloud build require `strict`; in the local build accept anything and
 *  fall back to `placeholder` (keeps the field's inferred type = `string`). */
function cloudRequired(strict: z.ZodType<string>, placeholder: string) {
  return isLocal ? z.string().default(placeholder) : strict;
}
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
//
// SHAPE VALIDATION (audit R4 #4): a value that doesn't LOOK like a Stripe key is
// almost always a paste error (wrong var, a placeholder, a truncated copy). We
// reject those by shape so a bogus key degrades payments to "off" (and we alarm
// below) instead of the app trying — and failing every call — with garbage
// credentials. Live/test secret keys are `sk_(test|live)_…`; restricted keys are
// `rk_(test|live)_…`; webhook signing secrets are `whsec_…`; publishable keys are
// `pk_(test|live)_…`.
const STRIPE_SECRET_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;
const STRIPE_PUBLISHABLE_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
const STRIPE_WEBHOOK_RE = /^whsec_[A-Za-z0-9]+$/;
const optionalStripeSecret = z
  .string()
  .regex(STRIPE_SECRET_RE)
  .optional()
  .catch(undefined);
const optionalStripePublishable = z
  .string()
  .regex(STRIPE_PUBLISHABLE_RE)
  .optional()
  .catch(undefined);
const optionalStripeWebhookSecret = z
  .string()
  .regex(STRIPE_WEBHOOK_RE)
  .optional()
  .catch(undefined);

const schema = z.object({
  // App runtime connection — use the POOLED Neon endpoint (pgbouncer=true).
  // Cloud-required; in the local build it's a SQLite path the Tauri shell owns,
  // so it degrades to a placeholder here.
  DATABASE_URL: cloudRequired(z.string().url(), "file:vallapos.db"),
  // Direct (non-pooled) connection used ONLY by the Prisma CLI for migrations
  // (schema.prisma `directUrl`). Not read by the client at runtime, so it is
  // optional here — an unset value must never fail the boot/build on Vercel,
  // where only the pooled DATABASE_URL is present. Required wherever `prisma
  // migrate`/`db:seed` runs (local .env, CI).
  DIRECT_URL: z.string().url().optional(),
  // Better Auth secret/URL + the hosted app URL: cloud-required, but the local
  // edition has no Better Auth and no hosted origin, so they degrade to unused
  // placeholders there. The local operator-PIN HMAC uses VALLA_LOCAL_DEVICE_SECRET
  // (below) instead of BETTER_AUTH_SECRET (see src/lib/operator.ts).
  BETTER_AUTH_SECRET: cloudRequired(z.string().min(16), "local-edition-better-auth-secret-unused"),
  BETTER_AUTH_URL: cloudRequired(z.string().url(), "http://localhost"),
  NEXT_PUBLIC_APP_URL: cloudRequired(z.string().url(), "http://localhost"),
  // LOCAL edition only: the on-device secret for the operator-PIN cookie HMAC
  // (there is no BETTER_AUTH_SECRET in local). Optional — the desktop shell
  // generates + injects a per-install secret (Stage 5); unset falls back to a
  // dev default in operator.ts. Ignored by the cloud build.
  VALLA_LOCAL_DEVICE_SECRET: z.string().min(16).optional(),
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

// The Upstash brute-force-lockout guard below is a CLOUD/serverless concern (the
// hosted app's per-instance in-memory fallback resets on cold starts). The local
// desktop edition has no Better Auth, no serverless fan-out, and no Upstash, so
// it must never trip the production fail-fast. Gate the whole block on !isLocal.
const isProduction = process.env.NODE_ENV === "production" && !isLocal;

/** True when a var was provided in the environment but our schema dropped it to
 * undefined (blank/malformed/wrong-shape) — i.e. a misconfiguration, not an
 * intentional "leave it off". */
function setButDropped(rawKey: string, parsedValue: unknown): boolean {
  return Boolean(process.env[rawKey]) && parsedValue === undefined;
}

// --- Upstash: a misconfigured shared rate-limit store is a SECURITY problem ---
// On serverless (Vercel) the in-memory fallback resets on every cold start and
// isn't shared across instances, so PIN/login brute-force lockout is effectively
// gutted (the H-3 finding). A quiet console.warn buried that; make it LOUD, and
// in production FAIL FAST when Upstash was clearly INTENDED (set-but-invalid) so
// a broken value can't silently ship a POS with no real lockout.
const upstashSetButInvalid =
  setButDropped("UPSTASH_REDIS_REST_URL", env.UPSTASH_REDIS_REST_URL) ||
  setButDropped("UPSTASH_REDIS_REST_TOKEN", env.UPSTASH_REDIS_REST_TOKEN);

if (upstashSetButInvalid) {
  const message =
    "⚠ SECURITY: UPSTASH_REDIS_REST_URL/TOKEN is set but INVALID — the shared, " +
    "persistent rate-limit/lockout store is DISABLED and auth fell back to " +
    "per-instance in-memory limiting. On serverless this resets every cold start " +
    "and is not shared across instances, so brute-force lockout is effectively " +
    "off. Fix the value to restore Redis-backed limiting.";
  console.error(message);
  // Clear guard: only fail the boot when the operator clearly INTENDED Redis
  // (they set the vars) AND we're in production. An intentional single-instance
  // deploy that leaves Upstash unset still boots (loud warning only, below).
  if (isProduction) {
    throw new Error(
      "Refusing to boot in production with an invalid Upstash config — brute-force " +
        "lockout would be disabled. Fix UPSTASH_REDIS_REST_URL/TOKEN or unset them.",
    );
  }
} else if (isProduction && (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)) {
  // Unset (not misconfigured) in production: we can't prove they didn't intend a
  // single-instance deploy, so we don't hard-fail — but this is dangerous on
  // serverless, so alarm loudly.
  console.error(
    "⚠ SECURITY: Upstash is NOT configured in production. Auth rate limiting / PIN " +
      "lockout is per-instance in-memory only, which on serverless resets on every " +
      "cold start and is not shared across instances — brute-force protection is " +
      "effectively disabled. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
  );
}

// --- Stripe: a bad key shape means payments quietly wouldn't work at all -------
// A set-but-wrong-shape Stripe var was dropped to undefined above (so the build
// survives), which turns integrated payments OFF. Alarm so the operator isn't
// left wondering why "Connect" does nothing.
if (setButDropped("STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY)) {
  console.error(
    "⚠ SECURITY: STRIPE_SECRET_KEY is set but does not look like a Stripe secret " +
      "key (expected sk_test_… / sk_live_… / rk_…) — ignoring it. Integrated " +
      "payments are DISABLED until a valid key is provided.",
  );
}
if (setButDropped("STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET)) {
  console.error(
    "⚠ SECURITY: STRIPE_WEBHOOK_SECRET is set but does not look like a Stripe " +
      "webhook signing secret (expected whsec_…) — ignoring it. Connect webhooks " +
      "cannot be verified and payments stay DISABLED until it is fixed.",
  );
}
if (setButDropped("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) {
  console.error(
    "⚠ SECURITY: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set but does not look like a " +
      "Stripe publishable key (expected pk_test_… / pk_live_…) — ignoring it.",
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
