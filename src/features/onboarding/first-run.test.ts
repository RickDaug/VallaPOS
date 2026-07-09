import { describe, it, expect } from "vitest";
import {
  onboardingView,
  isFirstRun,
  checklistSteps,
  checklistProgress,
  type FirstRunState,
  type OnboardingCaps,
} from "./first-run";

const OWNER: OnboardingCaps = { canManageSettings: true, canManageProducts: true };
const CASHIER: OnboardingCaps = { canManageSettings: false, canManageProducts: false };

function state(overrides: Partial<FirstRunState> = {}): FirstRunState {
  return { hasItems: false, hasSale: false, taxConfigured: false, ...overrides };
}

describe("onboardingView", () => {
  it("shows the checklist for a brand-new merchant (no sale)", () => {
    expect(onboardingView(state())).toBe("checklist");
    // still the checklist even once items/tax are set — until the first sale
    expect(onboardingView(state({ hasItems: true, taxConfigured: true }))).toBe("checklist");
  });

  it("shows a tax nudge after activation while tax is still 0%", () => {
    expect(onboardingView(state({ hasSale: true, taxConfigured: false }))).toBe("tax-nudge");
  });

  it("shows nothing once activated with tax configured", () => {
    expect(onboardingView(state({ hasSale: true, taxConfigured: true }))).toBe("none");
  });
});

describe("isFirstRun", () => {
  it("is true until the first completed sale", () => {
    expect(isFirstRun(state())).toBe(true);
    expect(isFirstRun(state({ hasItems: true }))).toBe(true);
    expect(isFirstRun(state({ hasSale: true }))).toBe(false);
  });
});

describe("checklistSteps", () => {
  it("lists tax, item, and sale for an owner in order", () => {
    const steps = checklistSteps(state(), OWNER);
    expect(steps.map((s) => s.key)).toEqual(["tax", "item", "sale"]);
    expect(steps.map((s) => s.href)).toEqual(["settings", "products", "register"]);
  });

  it("marks steps done from state; the sale step is never pre-done", () => {
    const steps = checklistSteps(state({ hasItems: true, taxConfigured: true }), OWNER);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s.done]));
    expect(byKey).toEqual({ tax: true, item: true, sale: false });
  });

  it("omits owner-only steps a cashier can't act on (only 'make a sale' remains)", () => {
    const steps = checklistSteps(state(), CASHIER);
    expect(steps.map((s) => s.key)).toEqual(["sale"]);
  });

  it("changes the tax/item CTA labels once those are done", () => {
    const fresh = checklistSteps(state(), OWNER);
    expect(fresh.find((s) => s.key === "tax")!.cta).toBe("Set tax");
    expect(fresh.find((s) => s.key === "item")!.cta).toBe("Add item");
    const done = checklistSteps(state({ hasItems: true, taxConfigured: true }), OWNER);
    expect(done.find((s) => s.key === "tax")!.cta).toBe("Review");
    expect(done.find((s) => s.key === "item")!.cta).toBe("Add more");
  });
});

describe("checklistProgress", () => {
  it("counts completed steps out of the total", () => {
    const steps = checklistSteps(state({ hasItems: true }), OWNER);
    expect(checklistProgress(steps)).toEqual({ done: 1, total: 3 });
  });
});
