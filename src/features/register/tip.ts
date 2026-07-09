/**
 * Pure tip math for the register's ethical tip screen (no React/Prisma imports,
 * so it's unit-testable). INTEGER CENTS only — never floats leaking into stored
 * amounts.
 *
 * A tip is one of three explicit selections. "None" is a first-class, equally
 * prominent choice (hiding No-Tip is a dark pattern): the UI renders it as its
 * own button, never as an omission.
 */

export type TipSelection =
  | { kind: "none" }
  | { kind: "percent"; rate: number }
  | { kind: "custom"; cents: number };

/** Anchored percentage options shown alongside No-Tip and Custom. */
export const TIP_PERCENTS = [0.15, 0.2, 0.25] as const;

/** The default (nothing chosen) — a real "No tip", not a hidden 0. */
export const NO_TIP: TipSelection = { kind: "none" };

/**
 * Resolve a tip selection to integer cents against a base (the discounted
 * subtotal). Percentages round to the nearest cent; custom amounts are clamped
 * to a non-negative whole cent. Never returns a fractional or negative value.
 */
export function tipCentsFor(selection: TipSelection, baseCents: number): number {
  const base = Math.max(0, baseCents);
  switch (selection.kind) {
    case "none":
      return 0;
    case "percent":
      return Math.max(0, Math.round(base * selection.rate));
    case "custom":
      return Math.max(0, Math.round(selection.cents));
  }
}
