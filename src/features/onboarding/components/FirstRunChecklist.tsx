"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Lock, LockOpen, Percent, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  checklistProgress,
  checklistSteps,
  onboardingView,
  type FirstRunState,
  type OnboardingCaps,
} from "@/features/onboarding/first-run";
import { getSingleOperatorMode, setSingleOperatorMode } from "@/features/onboarding/actions";

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

  // Per-device "I charge no tax" acknowledgement so a 0%-tax merchant can
  // complete the tax step instead of being nudged forever (audit R2 #4).
  const taxAckKey = `vp_tax_ack_${businessId}`;
  const [taxAcknowledged, setTaxAcknowledged] = useState(false);
  useEffect(() => {
    setTaxAcknowledged(localStorage.getItem(taxAckKey) === "1");
  }, [taxAckKey]);

  function acknowledgeNoTax() {
    localStorage.setItem(taxAckKey, "1");
    setTaxAcknowledged(true);
  }

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  }

  const steps = checklistSteps(state, caps, { taxAcknowledged });
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
                {step.key === "tax" && !step.done && (
                  <button
                    type="button"
                    onClick={acknowledgeNoTax}
                    className="mt-1 text-sm font-medium text-primary underline underline-offset-2"
                  >
                    I don&apos;t charge tax
                  </button>
                )}
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

      {!collapsed && caps.canManageSettings && <StayUnlockedCard businessId={businessId} />}
    </section>
  );
}

/**
 * Surfaces the "stay unlocked" (single-operator) choice during first run so a
 * solo owner discovers it without digging into Settings (audit R2 #1b). New
 * businesses default to unlocked; this lets them confirm it or switch to the
 * shared-till behavior before they hire staff. Reads/writes the real setting via
 * server actions, capability-gated to owners/managers.
 */
function StayUnlockedCard({ businessId }: { businessId: string }) {
  const [value, setValue] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    getSingleOperatorMode(businessId)
      .then((v) => active && setValue(v))
      .catch(() => active && setValue(null));
    return () => {
      active = false;
    };
  }, [businessId]);

  async function onToggle(next: boolean) {
    setPending(true);
    setValue(next); // optimistic
    try {
      await setSingleOperatorMode(businessId, next);
    } catch {
      setValue(!next); // revert on failure
    } finally {
      setPending(false);
    }
  }

  if (value === null) return null;

  return (
    <div className="mx-4 mb-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {value ? <LockOpen size={16} /> : <Lock size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-tight">Stay unlocked while you sell solo</span>
        <span className="block text-sm text-muted-foreground">
          {value
            ? "The register won't re-lock after each sale — perfect for one person on one device. Turn this off when you add staff who share a till."
            : "The register locks after each sale so staff sign in per shift. Turn on to skip re-locking while you sell solo."}
        </span>
      </span>
      <label className="flex shrink-0 items-center gap-2">
        <span className="sr-only">Stay unlocked (single operator mode)</span>
        <input
          type="checkbox"
          checked={value}
          disabled={pending}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label="Stay unlocked (single operator mode)"
          className="h-5 w-5 accent-primary"
        />
      </label>
    </div>
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
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-warning-foreground">
      <Percent size={18} className="shrink-0" aria-hidden />
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
