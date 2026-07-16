"use client";

/**
 * Settings → Payroll Tax (Beta). Onboarding CTA for the embedded payroll provider
 * (Check), mirroring the Stripe PaymentsConnect section: when the provider isn't
 * configured on this deployment (CHECK_* env unset or the platform flag off) it
 * shows a DORMANT notice instead of a dead button. When configured, it lets an
 * owner opt in + onboard their business as employer of record.
 *
 * This screen never moves money or files anything — it only starts/refreshes the
 * provider onboarding. VallaPOS is software; the provider computes/​files/​remits
 * tax and the merchant is employer of record (docs/PAYROLL_TAX.md §compliance).
 */

import { useState, useTransition } from "react";
import { Landmark, ExternalLink, RefreshCw, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  startPayrollTaxOnboarding,
  refreshPayrollTaxOnboarding,
  setPayrollTaxEnabled,
} from "@/features/payroll/tax/actions";
import type { PayrollTaxSettingsView } from "@/features/payroll/tax/queries";
import type { OnboardingStatus } from "@/features/payroll/tax/gateway";

const STATUS_LABEL: Record<OnboardingStatus, string> = {
  not_started: "Not started",
  needs_attention: "Action needed",
  in_review: "In review",
  completed: "Ready",
  blocked: "Blocked",
};

export function PayrollTaxOnboarding({
  businessId,
  initial,
}: {
  businessId: string;
  initial: PayrollTaxSettingsView;
}) {
  const { toast } = useToast();
  const [view, setView] = useState(initial);
  const [pending, startTransition] = useTransition();

  function onboard() {
    startTransition(async () => {
      try {
        const result = await startPayrollTaxOnboarding({ businessId });
        if (!result.ok) {
          toast({ title: "Payroll tax isn't enabled on this deployment", variant: "error" });
          return;
        }
        if (result.onboardingUrl) {
          window.location.href = result.onboardingUrl;
          return;
        }
        setView((v) => ({ ...v, connected: true }));
        toast({ title: "Onboarding started", variant: "success" });
      } catch {
        toast({ title: "Couldn't start onboarding", variant: "error" });
      }
    });
  }

  function refresh() {
    startTransition(async () => {
      try {
        const result = await refreshPayrollTaxOnboarding({ businessId });
        if (!result.ok) {
          toast({ title: "Payroll tax isn't enabled", variant: "error" });
          return;
        }
        setView((v) => ({
          ...v,
          connected: result.view.connected,
          status: result.view.status,
        }));
        toast({
          title: result.view.status === "completed" ? "Onboarding complete" : "Still onboarding",
          variant: result.view.status === "completed" ? "success" : "default",
        });
      } catch {
        toast({ title: "Couldn't refresh status", variant: "error" });
      }
    });
  }

  function toggle() {
    startTransition(async () => {
      try {
        const result = await setPayrollTaxEnabled({ businessId });
        if (!result.ok) {
          toast({ title: "Payroll tax isn't enabled on this deployment", variant: "error" });
          return;
        }
        setView((v) => ({ ...v, businessEnabled: result.enabled }));
        toast({
          title: result.enabled ? "Automated withholding on" : "Automated withholding off",
          variant: "success",
        });
      } catch {
        toast({ title: "Couldn't update", variant: "error" });
      }
    });
  }

  // Dormant on this deployment (platform flag off or provider keys unset) — show a
  // clear notice instead of a dead button, exactly like the Payments section.
  if (!view.configured) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6 text-sm text-muted-foreground">
          <Landmark className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Automated payroll-tax withholding isn&apos;t enabled on this deployment yet. Payroll
            still records <strong>gross pay, adjustments, and net</strong> and exports a CSV for your
            accountant or payroll provider &mdash; <strong>no withholding is computed</strong>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const ready = view.status === "completed";

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          {ready ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3.5" aria-hidden /> {STATUS_LABEL[view.status]}
            </Badge>
          ) : view.connected ? (
            <Badge variant={view.status === "blocked" ? "muted" : "warning"} className="gap-1">
              {view.status === "blocked" ? (
                <AlertTriangle className="size-3.5" aria-hidden />
              ) : (
                <Clock className="size-3.5" aria-hidden />
              )}
              {STATUS_LABEL[view.status]}
            </Badge>
          ) : (
            <Badge variant="muted">Not connected</Badge>
          )}
          {view.businessEnabled && (
            <span className="text-xs text-muted-foreground">Automated withholding on</span>
          )}
        </div>

        <p className="max-w-prose text-sm text-muted-foreground">
          {ready
            ? "Your business is onboarded as employer of record. The provider computes tax withholding and files/remits; VallaPOS computes hours + gross and orchestrates the run."
            : view.connected
              ? "Onboarding started. The provider still needs details (business, tax accounts, bank) before it can run payroll. Finish it, then refresh."
              : "Connect your business to an embedded payroll provider so tax withholding is computed, filed, and remitted for you. You are the employer of record; VallaPOS is the software, not a payroll company or tax advisor."}
        </p>

        <div className="flex flex-wrap gap-2">
          {!ready && (
            <Button onClick={onboard} disabled={pending} className="gap-2">
              <ExternalLink className="size-4" aria-hidden />
              {view.connected ? "Finish onboarding" : "Start onboarding"}
            </Button>
          )}
          {view.connected && (
            <Button variant="outline" onClick={refresh} disabled={pending} className="gap-2">
              <RefreshCw className="size-4" aria-hidden /> Refresh status
            </Button>
          )}
          {ready && (
            <Button variant={view.businessEnabled ? "outline" : "primary"} onClick={toggle} disabled={pending}>
              {view.businessEnabled ? "Turn off withholding" : "Turn on withholding"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
