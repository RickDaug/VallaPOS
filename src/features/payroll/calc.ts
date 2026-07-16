/**
 * Payroll calculation — the CORRECTNESS CORE. Pure functions only (no
 * `server-only`/Prisma imports) so every path is unit-testable and reusable on
 * the client for live previews.
 *
 * MONEY MODEL: everything is INTEGER CENTS. Rates are cents-per-hour (hourly) or
 * cents-per-year (salary). The overtime multiplier is BASIS POINTS (15000 = 1.5×,
 * 10000 = 1.0×). Money components are each rounded to a whole cent (standard
 * half-up) and then summed — so the stored gross is always the sum of its stored
 * parts and can't drift.
 *
 * HARD BOUNDARY: this computes GROSS pay + manual adjustments + NET. It does NOT
 * compute statutory tax withholding, FICA, or any government filing (see
 * docs/PAYROLL.md). Net here is "gross + additions − deductions", NOT take-home.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Time / hours
// ─────────────────────────────────────────────────────────────────────────────

/** A clock-in/out shift interval. An OPEN entry has clockOutAt === null. */
export interface TimeInterval {
  clockInAt: Date;
  clockOutAt: Date | null;
}

/** Inclusive-start, exclusive-end pay-period window: [start, end). */
export interface PeriodWindow {
  start: Date;
  end: Date;
}

export interface OvertimeRule {
  /** When false, all worked minutes are "regular" (no OT split). */
  enabled: boolean;
  /** Minutes over this per-workweek threshold are overtime. Default 2400 (40h). */
  weeklyThresholdMinutes: number;
  /** Overtime pay multiplier in basis points. Default 15000 (1.5×). */
  multiplierBps: number;
}

export const DEFAULT_OT_THRESHOLD_MINUTES = 2400; // 40h
export const DEFAULT_OT_MULTIPLIER_BPS = 15000; // 1.5×

export const DEFAULT_OVERTIME: OvertimeRule = {
  enabled: true,
  weeklyThresholdMinutes: DEFAULT_OT_THRESHOLD_MINUTES,
  multiplierBps: DEFAULT_OT_MULTIPLIER_BPS,
};

const MS_PER_MINUTE = 60_000;
const MS_PER_WEEK = 7 * 24 * 60 * MS_PER_MINUTE;

/** A half-open [start, end) span in epoch milliseconds. */
interface MsSpan {
  start: number;
  end: number;
}

/**
 * Clip a shift interval to the pay-period window. An OPEN shift (no clockOutAt)
 * is measured to `asOf` (the compute instant) — so an in-progress shift still
 * contributes the hours worked so far. Returns null when there is no positive
 * overlap. Negative/zero spans (clock skew, zero-length) yield null.
 */
export function clipInterval(
  entry: TimeInterval,
  window: PeriodWindow,
  asOf: Date,
): MsSpan | null {
  const rawStart = entry.clockInAt.getTime();
  const rawEnd = (entry.clockOutAt ?? asOf).getTime();
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const start = Math.max(rawStart, window.start.getTime());
  const end = Math.min(rawEnd, window.end.getTime());
  if (end <= start) return null;
  return { start, end };
}

/**
 * Union of half-open spans — merges overlapping AND touching spans so no minute
 * is ever counted twice (payroll must never double-pay a minute two shifts both
 * cover). Input need not be sorted. Returns disjoint spans sorted by start.
 */
export function mergeSpans(spans: MsSpan[]): MsSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: MsSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Split disjoint spans into per-workweek buckets and total minutes per week.
 *
 * A "workweek" is a fixed 7-day block ANCHORED at the pay-period start (week 0 =
 * [start, start+7d), week 1 = [start+7d, start+14d), …). This is deterministic
 * and timezone-independent; it does not attempt FLSA's calendar-weekday
 * workweek. Minutes are floored to whole minutes per span before bucketing.
 *
 * Returns weekly totals in ascending week order (only weeks with minutes).
 */
export function minutesByWeek(spans: MsSpan[], anchor: Date): number[] {
  const anchorMs = anchor.getTime();
  const byWeek = new Map<number, number>();

  for (const span of mergeSpans(spans)) {
    let cursor = span.start;
    while (cursor < span.end) {
      const weekIndex = Math.floor((cursor - anchorMs) / MS_PER_WEEK);
      const weekEnd = anchorMs + (weekIndex + 1) * MS_PER_WEEK;
      const segmentEnd = Math.min(span.end, weekEnd);
      const minutes = Math.floor((segmentEnd - cursor) / MS_PER_MINUTE);
      byWeek.set(weekIndex, (byWeek.get(weekIndex) ?? 0) + minutes);
      cursor = segmentEnd;
    }
  }

  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);
}

export interface WorkedHours {
  /** Total worked minutes in the window (regular + overtime). */
  totalMinutes: number;
  /** Minutes at the base rate (≤ threshold per week, summed across weeks). */
  regularMinutes: number;
  /** Minutes over the weekly threshold (0 when OT disabled). */
  overtimeMinutes: number;
  /** How many of the input entries were still OPEN (measured to `asOf`). */
  openShiftCount: number;
}

/**
 * Turn clock intervals into regular/overtime worked minutes for the window.
 * Overlaps are merged (never double-counted); OT is split per workweek.
 */
export function computeWorkedHours(
  entries: TimeInterval[],
  window: PeriodWindow,
  rule: OvertimeRule,
  asOf: Date = new Date(),
): WorkedHours {
  const spans: MsSpan[] = [];
  let openShiftCount = 0;
  for (const e of entries) {
    if (e.clockOutAt === null) openShiftCount += 1;
    const clipped = clipInterval(e, window, asOf);
    if (clipped) spans.push(clipped);
  }

  const weeks = minutesByWeek(spans, window.start);
  const totalMinutes = weeks.reduce((s, m) => s + m, 0);

  if (!rule.enabled) {
    return { totalMinutes, regularMinutes: totalMinutes, overtimeMinutes: 0, openShiftCount };
  }

  const threshold = Math.max(0, rule.weeklyThresholdMinutes);
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  for (const weekMinutes of weeks) {
    const regular = Math.min(weekMinutes, threshold);
    regularMinutes += regular;
    overtimeMinutes += weekMinutes - regular;
  }

  return { totalMinutes, regularMinutes, overtimeMinutes, openShiftCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

/** Round to the nearest whole cent (standard half-up), matching src/lib/money.ts. */
export function roundCents(value: number): number {
  return Math.round(value);
}

/** Pay for `minutes` at `hourlyCents`/hour, rounded to the cent. */
export function payForMinutes(minutes: number, hourlyCents: number): number {
  return roundCents((minutes / 60) * hourlyCents);
}

/**
 * Overtime pay for `minutes` at `hourlyCents`/hour × `multiplierBps`/10000,
 * rounded to the cent. A 1.0× (10000 bps) multiplier pays the base rate.
 */
export function overtimePayForMinutes(
  minutes: number,
  hourlyCents: number,
  multiplierBps: number,
): number {
  return roundCents((minutes / 60) * hourlyCents * (multiplierBps / 10_000));
}

/** Number of whole days in [start, end) (fractional days included). */
export function periodDays(window: PeriodWindow): number {
  const ms = window.end.getTime() - window.start.getTime();
  return ms > 0 ? ms / (24 * 60 * MS_PER_MINUTE) : 0;
}

const DAYS_PER_YEAR = 365; // fixed divisor — deterministic; ignores leap years (documented)

/**
 * Prorate an annual salary to the pay period: annual × periodDays / 365, rounded
 * to the cent. A fixed 365-day year keeps proration deterministic and
 * documented (a leap year is not specially handled).
 */
export function proratedSalary(annualCents: number, window: PeriodWindow): number {
  return roundCents((annualCents * periodDays(window)) / DAYS_PER_YEAR);
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjustments
// ─────────────────────────────────────────────────────────────────────────────

export type AdjustmentKind = "ADDITION" | "DEDUCTION";

export interface AdjustmentLine {
  kind: AdjustmentKind;
  /** Always POSITIVE; the sign in net comes from `kind`. */
  amountCents: number;
}

export interface AdjustmentTotals {
  additionsCents: number;
  deductionsCents: number;
}

/** Sum adjustment lines into additions (ADDITION) and deductions (DEDUCTION). */
export function sumAdjustments(lines: AdjustmentLine[]): AdjustmentTotals {
  let additionsCents = 0;
  let deductionsCents = 0;
  for (const line of lines) {
    const amt = Math.max(0, Math.round(line.amountCents));
    if (line.kind === "ADDITION") additionsCents += amt;
    else deductionsCents += amt;
  }
  return { additionsCents, deductionsCents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payslip
// ─────────────────────────────────────────────────────────────────────────────

export type PayType = "HOURLY" | "SALARY";

export interface PayslipInput {
  payType: PayType;
  entries: TimeInterval[];
  window: PeriodWindow;
  /** HOURLY: pay per hour in cents. */
  hourlyCents: number;
  /** SALARY: annual salary in cents. */
  annualCents: number;
  overtime: OvertimeRule;
  adjustments: AdjustmentLine[];
  /** Compute instant — open shifts are measured to this. Defaults to now(). */
  asOf?: Date;
}

export interface PayslipComputation {
  payType: PayType;
  regularMinutes: number;
  overtimeMinutes: number;
  openShiftCount: number;
  hourlyCents: number;
  annualCents: number;
  otMultiplierBps: number;
  regularPayCents: number;
  overtimePayCents: number;
  grossCents: number;
  additionsCents: number;
  deductionsCents: number;
  /** gross + additions − deductions. NOT clamped (a large deduction can push it below 0). */
  netCents: number;
}

/**
 * Compute a full payslip from clocked hours + a pay rate + manual adjustments.
 *
 * HOURLY: gross = payForMinutes(regular) + overtimePayForMinutes(overtime); the
 * hours come from TimeEntry, split into regular/overtime by the weekly rule.
 *
 * SALARY: gross = annual prorated to the period by days/365; hours are still
 * recorded (for reference) but do NOT affect pay, and salaried workers get NO
 * overtime.
 *
 * net = gross + Σ additions − Σ deductions (deliberately NOT clamped at 0 so an
 * advance-repayment deduction that exceeds gross is visible, not silently hidden).
 */
export function computePayslip(input: PayslipInput): PayslipComputation {
  const asOf = input.asOf ?? new Date();
  const salaried = input.payType === "SALARY";

  // Salaried workers are not overtime-eligible: force a disabled OT rule so all
  // recorded hours land in `regularMinutes` (for reference) and none in OT.
  const rule: OvertimeRule = salaried ? { ...input.overtime, enabled: false } : input.overtime;
  const hours = computeWorkedHours(input.entries, input.window, rule, asOf);

  let regularPayCents: number;
  let overtimePayCents: number;
  let grossCents: number;

  if (salaried) {
    regularPayCents = proratedSalary(input.annualCents, input.window);
    overtimePayCents = 0;
    grossCents = regularPayCents;
  } else {
    regularPayCents = payForMinutes(hours.regularMinutes, input.hourlyCents);
    overtimePayCents = overtimePayForMinutes(
      hours.overtimeMinutes,
      input.hourlyCents,
      input.overtime.multiplierBps,
    );
    grossCents = regularPayCents + overtimePayCents;
  }

  const { additionsCents, deductionsCents } = sumAdjustments(input.adjustments);
  const netCents = grossCents + additionsCents - deductionsCents;

  return {
    payType: input.payType,
    regularMinutes: hours.regularMinutes,
    overtimeMinutes: hours.overtimeMinutes,
    openShiftCount: hours.openShiftCount,
    hourlyCents: salaried ? 0 : input.hourlyCents,
    annualCents: salaried ? input.annualCents : 0,
    otMultiplierBps: input.overtime.multiplierBps,
    regularPayCents,
    overtimePayCents,
    grossCents,
    additionsCents,
    deductionsCents,
    netCents,
  };
}

/** Resolve a worker's effective overtime rule from their PayRate config + defaults. */
export function overtimeRuleFrom(config: {
  otEnabled: boolean;
  otThresholdMinutes: number | null;
  otMultiplierBps: number | null;
}): OvertimeRule {
  return {
    enabled: config.otEnabled,
    weeklyThresholdMinutes: config.otThresholdMinutes ?? DEFAULT_OT_THRESHOLD_MINUTES,
    multiplierBps: config.otMultiplierBps ?? DEFAULT_OT_MULTIPLIER_BPS,
  };
}

/** Format whole minutes as a compact "Hh Mm" string (rounds down; guards junk). */
export function formatMinutes(totalMinutes: number): string {
  const safe = Number.isFinite(totalMinutes) && totalMinutes > 0 ? Math.floor(totalMinutes) : 0;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
