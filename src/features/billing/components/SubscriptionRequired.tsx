"use client";

/**
 * The HARD BLOCK screen (flat SaaS subscription, PAYMENTS.md §9, PR-D).
 *
 * Rendered by the business layout INSTEAD of the app ONLY when
 * `isBillingEnforced()` is true AND access resolves to "blocked". An OWNER can
 * always reach Subscribe from here (invariant #2 — never lock an owner out of
 * paying); a non-owner is told to ask the owner.
 */

import { useTransition } from "react";
import { CreditCard, ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startSubscriptionCheckout } from "@/features/billing/billing-actions";

export function SubscriptionRequired({
  businessId,
  businessName,
  isOwner,
}: {
  businessId: string;
  businessName: string;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function subscribe() {
    startTransition(async () => {
      try {
        const result = await startSubscriptionCheckout({ businessId });
        if (!result.ok) {
          toast({ title: "Subscriptions aren't available right now", variant: "error" });
          return;
        }
        window.location.href = result.url;
      } catch {
        toast({ title: "Couldn't start checkout", variant: "error" });
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Lock className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-xl font-black">Subscription required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isOwner
            ? `${businessName} needs an active VallaPOS subscription to continue. Subscribe to unlock the register, catalog, and reports.`
            : `${businessName} needs an active VallaPOS subscription to continue. Ask the business owner to subscribe from Settings.`}
        </p>

        {isOwner ? (
          <Button onClick={subscribe} disabled={pending} className="mt-6 w-full gap-2">
            <ExternalLink className="size-4" aria-hidden /> Subscribe
          </Button>
        ) : (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <CreditCard className="size-4 shrink-0" aria-hidden />
            Only the owner can subscribe.
          </div>
        )}
      </div>
    </div>
  );
}
