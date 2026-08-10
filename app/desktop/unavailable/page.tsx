import type { Metadata } from "next";
import Link from "next/link";

/**
 * Honest failure page for the $99 one-time desktop purchase (audit U-1).
 *
 * `/desktop/buy` used to fall back to `/#pricing` when Stripe was unconfigured
 * or the Checkout Session failed to create — the reasoning being that the
 * button then "never appears broken". That is backwards for a BUY button: the
 * visitor lands back on the page they were already on with no message, and
 * concludes the product is abandoned rather than that a key is misconfigured.
 * (This is exactly what happened in production: a malformed STRIPE_SECRET_KEY
 * was silently dropped by env.ts, and every Buy button became a no-op.)
 *
 * A dead end you can see beats a dead end you can't. This page says what went
 * wrong, gives a way to reach a human, and keeps the other edition reachable.
 */
export const metadata: Metadata = {
  title: "Purchase temporarily unavailable",
  description: "The VallaPOS Offline checkout is temporarily unavailable.",
  robots: { index: false, follow: false },
};

export default function DesktopUnavailablePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        VallaPOS Offline · $99
      </p>
      <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
        We can&apos;t take your payment right now.
      </h1>
      <p className="mt-4 text-muted-foreground">
        Checkout for the one-time desktop license is temporarily unavailable — this is a problem on
        our side, not yours. Nothing was charged.
      </p>
      <p className="mt-3 text-muted-foreground">
        Email us at{" "}
        <a
          href="mailto:hello@vallapos.com?subject=VallaPOS%20Offline%20(%2499)%20purchase"
          className="font-semibold text-primary underline"
        >
          hello@vallapos.com
        </a>{" "}
        and we&apos;ll set you up directly and tell you the moment it&apos;s fixed.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/sign-up"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground"
        >
          Try VallaPOS Cloud instead
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 font-semibold"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
