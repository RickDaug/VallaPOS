"use client";

/**
 * Settings → Payments (Stripe Connect onboarding, PAYMENTS.md §9, PR-A).
 *
 * Beta, manage_settings-gated. Lets an owner connect their own Stripe account so
 * the business can (in a later PR) accept card/QR payments — the business is the
 * merchant of record; VallaPOS takes no cut. This screen ONLY onboards; it does
 * not move money. When integrated payments aren't configured on the deployment,
 * it shows a dormant notice instead of a dead button.
 */

import { useState, useTransition } from "react";
import { CreditCard, ExternalLink, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  startPaymentsOnboarding,
  refreshPaymentsOnboarding,
} from "@/features/payments/connect-actions";
import type { PaymentsConnectView } from "@/features/payments/connect-queries";

export function PaymentsConnect({
  businessId,
  initial,
}: {
  businessId: string;
  initial: PaymentsConnectView;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();

  function connect() {
    startTransition(async () => {
      try {
        const result = await startPaymentsOnboarding({ businessId });
        if (!result.ok) {
          toast({
            title: "Couldn't start onboarding",
            description:
              result.reason === "unsupported_country"
                ? "This business's country isn't supported for payments yet."
                : "Integrated payments aren't configured on this deployment.",
            variant: "error",
          });
          return;
        }
        // Hand off to Stripe's hosted onboarding.
        window.location.href = result.onboardingUrl;
      } catch {
        toast({ title: "Couldn't start onboarding", variant: "error" });
      }
    });
  }

  function refresh() {
    startTransition(async () => {
      try {
        const result = await refreshPaymentsOnboarding({ businessId });
        if (!result.ok) {
          toast({ title: "Payments aren't configured", variant: "error" });
          return;
        }
        setStatus((s) => ({
          ...s,
          connected: result.status.connected,
          chargesEnabled: result.status.chargesEnabled,
        }));
        toast({
          title: result.status.chargesEnabled
            ? "Ready to accept payments"
            : "Still finishing onboarding",
          variant: result.status.chargesEnabled ? "success" : "default",
        });
      } catch {
        toast({ title: "Couldn't refresh status", variant: "error" });
      }
    });
  }

  // Feature dormant on this deployment (no Stripe keys) — show a clear notice.
  if (!status.configured) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6 text-sm text-muted-foreground">
          <CreditCard className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Integrated card/QR payments aren&apos;t enabled on this deployment yet. Today you can
            still take <strong>cash</strong>, <strong>manual/other</strong> tenders, and your own
            <strong> QR handle</strong> (PIX/Venmo/etc.) from the register.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          {status.chargesEnabled ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3.5" aria-hidden /> Ready
            </Badge>
          ) : status.connected ? (
            <Badge variant="warning" className="gap-1">
              <Clock className="size-3.5" aria-hidden /> Onboarding
            </Badge>
          ) : (
            <Badge variant="muted">Not connected</Badge>
          )}
          <span className="text-xs text-muted-foreground">Country: {status.country}</span>
        </div>

        <p className="max-w-prose text-sm text-muted-foreground">
          {status.chargesEnabled
            ? "Your Stripe account is connected and can accept card payments. The in-app QR checkout rail turns on in a later update."
            : status.connected
              ? "Onboarding started but Stripe still needs a few details before this account can take payments. Finish it, then refresh."
              : "Connect your own Stripe account to accept card and QR payments. You stay the merchant of record and keep your payouts — VallaPOS takes no cut of your sales."}
        </p>

        <div className="flex flex-wrap gap-2">
          {!status.chargesEnabled && (
            <Button onClick={connect} disabled={pending} className="gap-2">
              <ExternalLink className="size-4" aria-hidden />
              {status.connected ? "Finish onboarding" : "Connect Stripe"}
            </Button>
          )}
          {status.connected && (
            <Button variant="outline" onClick={refresh} disabled={pending} className="gap-2">
              <RefreshCw className="size-4" aria-hidden /> Refresh status
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
