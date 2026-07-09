"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Percent, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  checklistProgress,
  checklistSteps,
  onboardingView,
  type FirstRunState,
  type OnboardingCaps,
} from "@/features/onboarding/first-run";

/**
 * First-run activation surface, rendered above the app content until the
 * merchant makes their first sale (audit #3), then a slim tax reminder while the
 * tax rate is still 0% (audit #6). Purely a guide — every tab stays reachable.
 */
export function FirstRunChecklist({
  businessId,
  state,
  caps,
}: {
  businessId: string;
  state: FirstRunState;
  caps: OnboardingCaps;
}) {
  const view = onboardingView(state);
  if (view === "checklist") {
    return <Checklist businessId={businessId} state={state} caps={caps} />;
  }
  if (view === "tax-nudge" && caps.canManageSettings) {
    return <TaxNudge businessId={businessId} />;
  }
  return null;
}

function Checklist({
  businessId,
  state,
  caps,
}: {
  businessId: string;
  state: FirstRunState;
  caps: OnboardingCaps;
}) {
  const key = `vp_firstrun_collapsed_${businessId}`;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(key) === "1");
  }, [key]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  }

  const steps = checklistSteps(state, caps);
  const { done, total } = checklistProgress(steps);

  return (
    <section
      aria-label="Get started"
      className="mb-6 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.06] shadow-sm"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-tight">Get set up to sell</span>
          <span className="block text-sm text-muted-foreground">
            {done} of {total} done · finish to start ringing up sales
          </span>
        </span>
        <span className="text-muted-foreground">
          {collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </span>
      </button>

      {!collapsed && (
        <ol className="space-y-2 px-4 pb-4">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  step.done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                {step.done ? <Check size={16} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block font-semibold leading-tight",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.title}
                </span>
                <span className="block text-sm text-muted-foreground">{step.description}</span>
              </span>
              <Link
                href={`/${businessId}/${step.href}`}
                className={cn(
                  buttonVariants({ variant: step.done ? "outline" : "primary", size: "sm" }),
                  "shrink-0",
                )}
              >
                {step.cta}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Slim, dismissible reminder shown after activation while tax is still 0%
 * (audit #6). Non-blocking: some merchants legitimately charge no tax and can
 * dismiss it. Dismissal is per-business + per-device (localStorage).
 */
function TaxNudge({ businessId }: { businessId: string }) {
  const key = `vp_taxnudge_dismissed_${businessId}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(localStorage.getItem(key) !== "1");
  }, [key]);

  if (!show) return null;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <Percent size={18} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Your tax rate is 0%.</span>{" "}
        <span className="text-muted-foreground">
          Set it now if you charge tax — no rush if you don&apos;t.
        </span>
      </p>
      <Link
        href={`/${businessId}/settings`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
      >
        Set tax
      </Link>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(key, "1");
          setShow(false);
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X size={16} />
      </button>
    </div>
  );
}
