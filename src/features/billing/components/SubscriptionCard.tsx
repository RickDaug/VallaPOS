"use client";

/**
 * Settings → Subscription (flat SaaS plan, PAYMENTS.md §9, PR-D).
 *
 * Visible only when `isBillingConfigured()` (the caller gates on that). Shows the
 * current subscription status; an OWNER sees a Subscribe button (no subscription)
 * or a Manage-billing button (a platform Customer exists), while non-owners see a
 * read-only status. Actions are additionally OWNER-enforced on the server.
 */

import { useState, useTransition } from "react";
import { CreditCard, ExternalLink, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  startSubscriptionCheckout,
  openBillingPortal,
} from "@/features/billing/billing-actions";
import { resolveSubscriptionAccess } from "@/features/billing/subscription-access";
import type { SubscriptionStateView } from "@/features/billing/billing-queries";

export function SubscriptionCard({
  businessId,
  initial,
  isOwner,
}: {
  businessId: string;
  initial: SubscriptionStateView;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [state] = useState(initial);

  const access = resolveSubscriptionAccess(state.status);

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

  function manage() {
    startTransition(async () => {
      try {
        const result = await openBillingPortal({ businessId });
        if (!result.ok) {
          toast({
            title:
              result.reason === "no_customer"
                ? "No billing profile yet — subscribe first"
                : "Billing isn't available right now",
            variant: "error",
          });
          return;
        }
        window.location.href = result.url;
      } catch {
        toast({ title: "Couldn't open billing", variant: "error" });
      }
    });
  }

  const periodEnd = state.currentPeriodEnd
    ? new Date(state.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          {access === "allowed" ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {state.status === "trialing" ? "Trial" : "Active"}
            </Badge>
          ) : access === "grace" ? (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="size-3.5" aria-hidden /> Past due
            </Badge>
          ) : state.status ? (
            <Badge variant="destructive" className="gap-1">
              <Clock className="size-3.5" aria-hidden /> Inactive
            </Badge>
          ) : (
            <Badge variant="muted">Not subscribed</Badge>
          )}
          {periodEnd && (
            <span className="text-xs text-muted-foreground">
              {access === "blocked" ? "Ended" : "Renews"} {periodEnd}
            </span>
          )}
        </div>

        <p className="max-w-prose text-sm text-muted-foreground">
          {access === "allowed"
            ? "Your VallaPOS subscription is active. Thanks for the support!"
            : access === "grace"
              ? "We couldn't process your latest payment. Update your billing details to keep your subscription — the app keeps working in the meantime."
              : state.status
                ? "Your subscription isn't active. Resubscribe to keep using VallaPOS on this plan."
                : "Subscribe to VallaPOS — a flat monthly plan for the full cloud POS. No per-sale cut."}
        </p>

        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            {state.hasCustomer ? (
              <Button variant="outline" onClick={manage} disabled={pending} className="gap-2">
                <CreditCard className="size-4" aria-hidden /> Manage billing
              </Button>
            ) : (
              <Button onClick={subscribe} disabled={pending} className="gap-2">
                <ExternalLink className="size-4" aria-hidden /> Subscribe
              </Button>
            )}
            {state.hasCustomer && access !== "allowed" && (
              <Button onClick={subscribe} disabled={pending} className="gap-2">
                <ExternalLink className="size-4" aria-hidden /> Resubscribe
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the business owner can manage the subscription.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
