"use client";

/**
 * The GRACE banner (flat SaaS subscription, PAYMENTS.md §9, PR-D).
 *
 * Rendered ABOVE the normal app by the business layout when `isBillingEnforced()`
 * is true AND access resolves to "grace" (`past_due`). The app stays fully usable
 * — this is a nudge, not a block. An OWNER gets a Manage-billing action; others
 * just see the notice.
 */

import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openBillingPortal } from "@/features/billing/billing-actions";

export function GraceBanner({
  businessId,
  isOwner,
}: {
  businessId: string;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function manage() {
    startTransition(async () => {
      try {
        const result = await openBillingPortal({ businessId });
        if (!result.ok) {
          toast({ title: "Billing isn't available right now", variant: "error" });
          return;
        }
        window.location.href = result.url;
      } catch {
        toast({ title: "Couldn't open billing", variant: "error" });
      }
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Your last subscription payment didn&apos;t go through. Update your billing to avoid
          losing access.
        </span>
      </div>
      {isOwner && (
        <Button size="sm" variant="outline" onClick={manage} disabled={pending} className="shrink-0">
          Manage billing
        </Button>
      )}
    </div>
  );
}
