/**
 * Pure cash-drawer reconciliation math. INTEGER CENTS only (no floats).
 *
 * Kept free of `server-only` / Prisma imports so it can be unit tested and
 * reused by the UI without dragging server modules into the bundle.
 *
 * Definitions (consistent with the Z-report's "cash collected"):
 *  - expected cash in the drawer = opening float + cash collected since open
 *  - variance = counted − expected (positive = OVER, negative = SHORT)
 */

/** Expected cash = opening float + cash collected during the open window. */
export function expectedCash(openingFloatCents: number, cashCollectedCents: number): number {
  return openingFloatCents + cashCollectedCents;
}

/** Variance = counted − expected. Positive is over, negative is short. */
export function computeVariance(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}

export type VarianceKind = "OVER" | "SHORT" | "EXACT";

/** Classify a variance for clear over/short labeling in the UI. */
export function varianceKind(varianceCents: number): VarianceKind {
  if (varianceCents > 0) return "OVER";
  if (varianceCents < 0) return "SHORT";
  return "EXACT";
}

export interface Reconciliation {
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  kind: VarianceKind;
}

/**
 * Reconcile a drawer at close. All inputs are coerced through `| 0`-style
 * guards by the callers (zod), but we defensively treat non-finite inputs as 0
 * so a count can never produce NaN totals.
 */
export function reconcile(
  openingFloatCents: number,
  cashCollectedCents: number,
  countedCents: number,
): Reconciliation {
  const float = Number.isFinite(openingFloatCents) ? openingFloatCents : 0;
  const cash = Number.isFinite(cashCollectedCents) ? cashCollectedCents : 0;
  const counted = Number.isFinite(countedCents) ? countedCents : 0;
  const expectedCents = expectedCash(float, cash);
  const varianceCents = computeVariance(counted, expectedCents);
  return {
    expectedCents,
    countedCents: counted,
    varianceCents,
    kind: varianceKind(varianceCents),
  };
}
