/**
 * First-run activation state + the pure logic that decides what onboarding
 * surface to show. "First run" is derived from data — a brand-new merchant has
 * made no completed sale yet — so there is NO schema flag to keep in sync.
 *
 * Pure module (no server-only / Prisma) so the branching is unit-tested; the DB
 * read that produces {@link FirstRunState} lives in ./queries.ts.
 */

export interface FirstRunState {
  /** The catalog has at least one item. */
  hasItems: boolean;
  /** A completed (paid/refunded) sale exists → the merchant is "activated". */
  hasSale: boolean;
  /** A non-zero tax rate has been configured (taxRateBps > 0). */
  taxConfigured: boolean;
}

/** What the merchant can act on (from the active operator's capabilities). */
export interface OnboardingCaps {
  canManageSettings: boolean;
  canManageProducts: boolean;
}

/** Optional per-device signals the pure logic can't derive from the DB. */
export interface OnboardingSignals {
  /**
   * The merchant explicitly acknowledged they charge no tax (0%). A valid,
   * completeable config — so the tax step counts as done even though
   * taxRateBps is 0 (audit R2 #4). Sourced from a per-device dismiss.
   */
  taxAcknowledged?: boolean;
}

/**
 * Which onboarding surface to render:
 *  - "checklist"  — brand-new merchant, no sale yet: the full get-started list.
 *  - "tax-nudge"  — activated, but tax is still 0%: a slim, dismissible reminder.
 *  - "none"       — nothing to show.
 */
export type OnboardingView = "checklist" | "tax-nudge" | "none";

export function onboardingView(state: FirstRunState): OnboardingView {
  if (!state.hasSale) return "checklist";
  if (!state.taxConfigured) return "tax-nudge";
  return "none";
}

/** True while the merchant has not yet completed their first sale. */
export function isFirstRun(state: FirstRunState): boolean {
  return !state.hasSale;
}

export interface ChecklistStep {
  key: "tax" | "item" | "sale";
  title: string;
  description: string;
  /** Relative path under /{businessId} the CTA links to. */
  href: string;
  cta: string;
  done: boolean;
}

/**
 * The ordered get-started steps. Item-first — adding something to sell is the
 * concrete activation move; tax is optional and comes after (audit R2 #5). Steps
 * the operator can't act on (no capability) are omitted so a cashier never sees
 * an owner-only task. The "make a sale" step is always present (anyone at the
 * till can ring up) and is the finish line — it only ever renders while
 * `hasSale` is false, so it's shown as not-done.
 */
export function checklistSteps(
  state: FirstRunState,
  caps: OnboardingCaps,
  signals: OnboardingSignals = {},
): ChecklistStep[] {
  const steps: ChecklistStep[] = [];

  if (caps.canManageProducts) {
    steps.push({
      key: "item",
      title: "Add your first item",
      description: "Build your catalog so there's something to tap on the register.",
      href: "products",
      cta: state.hasItems ? "Add more" : "Add item",
      done: state.hasItems,
    });
  }

  if (caps.canManageSettings) {
    // 0% tax is a valid setup, so an explicit "no tax" acknowledgement completes
    // this step just like a configured rate (audit R2 #4) — no perpetual nudge.
    const taxDone = state.taxConfigured || !!signals.taxAcknowledged;
    steps.push({
      key: "tax",
      title: "Set your tax & currency",
      description: "Confirm your tax rate and currency so totals are right from the first sale.",
      href: "settings",
      cta: taxDone ? "Review" : "Set tax",
      done: taxDone,
    });
  }

  steps.push({
    key: "sale",
    title: "Make your first sale",
    description: "Ring up an item and take payment — that's it, you're live.",
    href: "register",
    cta: "Open register",
    done: false,
  });

  return steps;
}

/** Count of completed steps / total (for the progress label). */
export function checklistProgress(steps: ChecklistStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}
