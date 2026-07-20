import type { Metadata } from "next";
import Link from "next/link";
import { desktopDownloadUrl } from "@/features/desktop-license/checkout-stripe";
import { prismaDesktopLicenseStore } from "@/features/desktop-license/prisma-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your VallaPOS Desktop license",
  robots: { index: false }, // a per-buyer page keyed on the Stripe session — never indexed
};

/**
 * Post-purchase success/download page. Stripe redirects here with
 * `?session_id=…`; we look up the issued License (which exists only for a PAID,
 * webhook-fulfilled session) and show the key + download link. If it isn't there
 * yet (webhook still in flight), show a "finishing up" state.
 */
export default async function DesktopLicensePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const license = session_id
    ? await prismaDesktopLicenseStore.findByStripeSession(session_id)
    : null;
  const downloadUrl = desktopDownloadUrl();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16 text-foreground">
      {license ? (
        <>
          <div>
            <h1 className="text-2xl font-black tracking-tight">You&rsquo;re all set 🎉</h1>
            <p className="mt-2 text-muted-foreground">
              Thanks for buying VallaPOS Desktop &mdash; it&rsquo;s yours to keep. Your license key
              is below (we also emailed it to you).
            </p>
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your license key
            </h2>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-sm">
              {license.licenseKey}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Keep this safe &mdash; it unlocks the app on your device, forever.
            </p>
          </section>

          <div className="flex flex-wrap gap-3">
            <a
              href={downloadUrl}
              className="inline-flex h-12 items-center rounded-lg bg-primary px-6 font-semibold text-primary-foreground"
            >
              Download the app
            </a>
            <Link
              href="/"
              className="inline-flex h-12 items-center rounded-lg border border-border px-6 font-semibold"
            >
              Back to home
            </Link>
          </div>

          <p className="text-sm text-muted-foreground">
            When you open the app, paste the key above when prompted.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-black tracking-tight">Finishing your purchase&hellip;</h1>
          <p className="text-muted-foreground">
            If you just paid, your license is being issued &mdash; it usually lands within a few
            seconds and we email it to you. Refresh this page in a moment, or check your inbox.
          </p>
          <Link href="/#pricing" className="text-sm font-semibold underline">
            Back to pricing
          </Link>
        </>
      )}
    </main>
  );
}
