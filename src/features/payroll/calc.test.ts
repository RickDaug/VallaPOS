import { describe, it, expect } from "vitest";
import {
  clipInterval,
  mergeSpans,
  minutesByWeek,
  computeWorkedHours,
  payForMinutes,
  overtimePayForMinutes,
  proratedSalary,
  periodDays,
  sumAdjustments,
  computePayslip,
  overtimeRuleFrom,
  formatMinutes,
  roundCents,
  DEFAULT_OVERTIME,
  DEFAULT_OT_THRESHOLD_MINUTES,
  type PeriodWindow,
  type TimeInterval,
  type OvertimeRule,
} from "./calc";

const t = (iso: string) => new Date(iso);
// A one-week window starting Mon 2026-06-01 00:00 UTC (anchor for OT weeks).
const WEEK: PeriodWindow = { start: t("2026-06-01T00:00:00Z"), end: t("2026-06-08T00:00:00Z") };
const TWO_WEEKS: PeriodWindow = { start: t("2026-06-01T00:00:00Z"), end: t("2026-06-15T00:00:00Z") };

const OT_OFF: OvertimeRule = { enabled: false, weeklyThresholdMinutes: 2400, multiplierBps: 15000 };

describe("clipInterval", () => {
  it("clips a shift to the window bounds", () => {
    const span = clipInterval(
      { clockInAt: t("2026-05-31T22:00:00Z"), clockOutAt: t("2026-06-01T02:00:00Z") },
      WEEK,
      t("2026-06-08T00:00:00Z"),
    );
    // Only the part inside the window (00:00 → 02:00 = 2h).
    expect(span).not.toBeNull();
    expect((span!.end - span!.start) / 3_600_000).toBe(2);
  });

  it("measures an OPEN shift to asOf", () => {
    const span = clipInterval(
      { clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: null },
      WEEK,
      t("2026-06-02T12:30:00Z"),
    );
    expect((span!.end - span!.start) / 3_600_000).toBe(3.5);
  });

  it("returns null for a zero-length or negative (clock-skew) span", () => {
    expect(
      clipInterval(
        { clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: t("2026-06-02T09:00:00Z") },
        WEEK,
        WEEK.end,
      ),
    ).toBeNull();
    expect(
      clipInterval(
        { clockInAt: t("2026-06-02T11:00:00Z"), clockOutAt: t("2026-06-02T10:00:00Z") },
        WEEK,
        WEEK.end,
      ),
    ).toBeNull();
  });

  it("returns null when the shift is entirely outside the window", () => {
    expect(
      clipInterval(
        { clockInAt: t("2026-07-01T09:00:00Z"), clockOutAt: t("2026-07-01T17:00:00Z") },
        WEEK,
        WEEK.end,
      ),
    ).toBeNull();
  });
});

describe("mergeSpans", () => {
  it("merges overlapping spans so a minute is never double-counted", () => {
    const merged = mergeSpans([
      { start: 0, end: 100 },
      { start: 50, end: 150 },
    ]);
    expect(merged).toEqual([{ start: 0, end: 150 }]);
  });

  it("merges touching spans and leaves disjoint spans apart", () => {
    const merged = mergeSpans([
      { start: 0, end: 100 },
      { start: 100, end: 200 }, // touches
      { start: 300, end: 400 }, // disjoint
    ]);
    expect(merged).toEqual([
      { start: 0, end: 200 },
      { start: 300, end: 400 },
    ]);
  });

  it("sorts unsorted input", () => {
    const merged = mergeSpans([
      { start: 300, end: 400 },
      { start: 0, end: 100 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 100 },
      { start: 300, end: 400 },
    ]);
  });
});

describe("minutesByWeek", () => {
  it("buckets minutes into 7-day weeks anchored at the period start", () => {
    // 8h in week 0, 8h in week 1.
    const spans = [
      { start: t("2026-06-02T09:00:00Z").getTime(), end: t("2026-06-02T17:00:00Z").getTime() },
      { start: t("2026-06-09T09:00:00Z").getTime(), end: t("2026-06-09T17:00:00Z").getTime() },
    ];
    expect(minutesByWeek(spans, TWO_WEEKS.start)).toEqual([480, 480]);
  });

  it("splits a span that crosses a week boundary", () => {
    // A shift straddling the week-0/week-1 boundary (Mon 2026-06-08 00:00Z).
    const spans = [
      { start: t("2026-06-07T22:00:00Z").getTime(), end: t("2026-06-08T02:00:00Z").getTime() },
    ];
    // 2h in week 0, 2h in week 1.
    expect(minutesByWeek(spans, TWO_WEEKS.start)).toEqual([120, 120]);
  });
});

describe("computeWorkedHours", () => {
  it("sums hours with no overtime when under the weekly threshold", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: t("2026-06-02T17:00:00Z") }, // 8h
    ];
    const h = computeWorkedHours(entries, WEEK, DEFAULT_OVERTIME, WEEK.end);
    expect(h.totalMinutes).toBe(480);
    expect(h.regularMinutes).toBe(480);
    expect(h.overtimeMinutes).toBe(0);
    expect(h.openShiftCount).toBe(0);
  });

  it("splits overtime exactly at the 40h weekly boundary", () => {
    // 41h in one week → 40h regular + 1h OT.
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-02T17:00:00Z") }, // 41h
    ];
    const h = computeWorkedHours(entries, WEEK, DEFAULT_OVERTIME, WEEK.end);
    expect(h.totalMinutes).toBe(41 * 60);
    expect(h.regularMinutes).toBe(DEFAULT_OT_THRESHOLD_MINUTES); // 2400 = 40h
    expect(h.overtimeMinutes).toBe(60);
  });

  it("no overtime at EXACTLY the threshold (40h → 0 OT)", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-02T16:00:00Z") }, // 40h
    ];
    const h = computeWorkedHours(entries, WEEK, DEFAULT_OVERTIME, WEEK.end);
    expect(h.regularMinutes).toBe(2400);
    expect(h.overtimeMinutes).toBe(0);
  });

  it("applies the threshold PER WEEK — 30h + 30h across two weeks yields no OT", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-02T06:00:00Z") }, // 30h week 0
      { clockInAt: t("2026-06-08T00:00:00Z"), clockOutAt: t("2026-06-09T06:00:00Z") }, // 30h week 1
    ];
    const h = computeWorkedHours(entries, TWO_WEEKS, DEFAULT_OVERTIME, TWO_WEEKS.end);
    expect(h.totalMinutes).toBe(60 * 60);
    expect(h.overtimeMinutes).toBe(0); // neither week exceeds 40h
    expect(h.regularMinutes).toBe(60 * 60);
  });

  it("merges overlapping shifts (never double-counts a minute)", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: t("2026-06-02T13:00:00Z") }, // 4h
      { clockInAt: t("2026-06-02T12:00:00Z"), clockOutAt: t("2026-06-02T15:00:00Z") }, // overlaps 12–13
    ];
    const h = computeWorkedHours(entries, WEEK, DEFAULT_OVERTIME, WEEK.end);
    expect(h.totalMinutes).toBe(6 * 60); // 09:00–15:00 = 6h, not 7h
  });

  it("counts open shifts and measures them to asOf", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: null },
    ];
    const h = computeWorkedHours(entries, WEEK, DEFAULT_OVERTIME, t("2026-06-02T12:00:00Z"));
    expect(h.totalMinutes).toBe(180);
    expect(h.openShiftCount).toBe(1);
  });

  it("puts all hours in regular when OT is disabled", () => {
    const entries: TimeInterval[] = [
      { clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-03T00:00:00Z") }, // 48h
    ];
    const h = computeWorkedHours(entries, WEEK, OT_OFF, WEEK.end);
    expect(h.regularMinutes).toBe(48 * 60);
    expect(h.overtimeMinutes).toBe(0);
  });

  it("is zero for no entries", () => {
    const h = computeWorkedHours([], WEEK, DEFAULT_OVERTIME, WEEK.end);
    expect(h).toEqual({ totalMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, openShiftCount: 0 });
  });
});

describe("money helpers", () => {
  it("roundCents is standard half-up", () => {
    expect(roundCents(1050.4)).toBe(1050);
    expect(roundCents(1050.5)).toBe(1051);
  });

  it("payForMinutes: 90 min @ $20/hr = $30.00", () => {
    expect(payForMinutes(90, 2000)).toBe(3000);
  });

  it("payForMinutes rounds a fractional cent deterministically", () => {
    // 20 min @ $15.00/hr = 5.0000 → $5.00; 10 min @ $15.005/hr not possible (int cents),
    // use 1 min @ $10.00/hr = 16.666.. cents → 17.
    expect(payForMinutes(1, 1000)).toBe(17);
  });

  it("overtimePayForMinutes at 1.5×", () => {
    // 60 min @ $20/hr × 1.5 = $30.00
    expect(overtimePayForMinutes(60, 2000, 15000)).toBe(3000);
  });

  it("overtimePayForMinutes at 1.0× equals base pay", () => {
    expect(overtimePayForMinutes(60, 2000, 10000)).toBe(payForMinutes(60, 2000));
  });
});

describe("proratedSalary", () => {
  it("prorates an annual salary by days/365", () => {
    // $52,000/yr over a 14-day period = 5200000 * 14 / 365 = 199452.05.. → 199452
    expect(proratedSalary(5_200_000, TWO_WEEKS)).toBe(roundCents((5_200_000 * 14) / 365));
    expect(proratedSalary(5_200_000, TWO_WEEKS)).toBe(199452);
  });

  it("periodDays counts the half-open window length", () => {
    expect(periodDays(WEEK)).toBe(7);
    expect(periodDays(TWO_WEEKS)).toBe(14);
  });

  it("is zero for a non-positive window", () => {
    expect(proratedSalary(5_200_000, { start: WEEK.end, end: WEEK.start })).toBe(0);
  });
});

describe("sumAdjustments", () => {
  it("separates additions and deductions (amounts stay positive)", () => {
    const totals = sumAdjustments([
      { kind: "ADDITION", amountCents: 5000 },
      { kind: "ADDITION", amountCents: 1500 },
      { kind: "DEDUCTION", amountCents: 2000 },
    ]);
    expect(totals).toEqual({ additionsCents: 6500, deductionsCents: 2000 });
  });

  it("clamps negative/fractional inputs defensively", () => {
    const totals = sumAdjustments([
      { kind: "ADDITION", amountCents: -100 },
      { kind: "DEDUCTION", amountCents: 10.7 },
    ]);
    expect(totals).toEqual({ additionsCents: 0, deductionsCents: 11 });
  });
});

describe("computePayslip — hourly", () => {
  it("computes gross from regular + overtime and net with adjustments", () => {
    // 41h @ $20/hr, 1.5× OT: 40h reg = $800, 1h OT = $30 → gross $830.
    // + $50 bonus − $20 advance = net $860.
    const slip = computePayslip({
      payType: "HOURLY",
      entries: [{ clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-02T17:00:00Z") }],
      window: WEEK,
      hourlyCents: 2000,
      annualCents: 0,
      overtime: DEFAULT_OVERTIME,
      adjustments: [
        { kind: "ADDITION", amountCents: 5000 },
        { kind: "DEDUCTION", amountCents: 2000 },
      ],
      asOf: WEEK.end,
    });
    expect(slip.regularPayCents).toBe(80000);
    expect(slip.overtimePayCents).toBe(3000);
    expect(slip.grossCents).toBe(83000);
    expect(slip.additionsCents).toBe(5000);
    expect(slip.deductionsCents).toBe(2000);
    expect(slip.netCents).toBe(86000);
    expect(slip.annualCents).toBe(0);
  });

  it("gross is exactly regularPay + overtimePay (no drift)", () => {
    const slip = computePayslip({
      payType: "HOURLY",
      entries: [{ clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-02T18:30:00Z") }],
      window: WEEK,
      hourlyCents: 1333, // odd rate to force rounding
      annualCents: 0,
      overtime: DEFAULT_OVERTIME,
      adjustments: [],
      asOf: WEEK.end,
    });
    expect(slip.grossCents).toBe(slip.regularPayCents + slip.overtimePayCents);
  });

  it("allows net to go negative when a deduction exceeds gross (not clamped)", () => {
    const slip = computePayslip({
      payType: "HOURLY",
      entries: [{ clockInAt: t("2026-06-02T09:00:00Z"), clockOutAt: t("2026-06-02T10:00:00Z") }], // 1h = $20
      window: WEEK,
      hourlyCents: 2000,
      annualCents: 0,
      overtime: DEFAULT_OVERTIME,
      adjustments: [{ kind: "DEDUCTION", amountCents: 5000 }],
      asOf: WEEK.end,
    });
    expect(slip.grossCents).toBe(2000);
    expect(slip.netCents).toBe(-3000);
  });
});

describe("computePayslip — salary", () => {
  it("prorates salary and ignores hours/overtime for pay", () => {
    // Worked 50h (would be OT if hourly), but salaried → prorate only.
    const slip = computePayslip({
      payType: "SALARY",
      entries: [{ clockInAt: t("2026-06-01T00:00:00Z"), clockOutAt: t("2026-06-03T02:00:00Z") }], // 50h
      window: TWO_WEEKS,
      hourlyCents: 0,
      annualCents: 5_200_000,
      overtime: DEFAULT_OVERTIME,
      adjustments: [],
      asOf: TWO_WEEKS.end,
    });
    expect(slip.overtimeMinutes).toBe(0); // salaried: never OT
    expect(slip.overtimePayCents).toBe(0);
    expect(slip.grossCents).toBe(proratedSalary(5_200_000, TWO_WEEKS));
    expect(slip.hourlyCents).toBe(0);
    expect(slip.annualCents).toBe(5_200_000);
    // Hours are still recorded for reference.
    expect(slip.regularMinutes).toBe(50 * 60);
  });
});

describe("overtimeRuleFrom", () => {
  it("falls back to defaults for null threshold/multiplier", () => {
    expect(overtimeRuleFrom({ otEnabled: true, otThresholdMinutes: null, otMultiplierBps: null })).toEqual(
      DEFAULT_OVERTIME,
    );
  });

  it("uses configured values when present", () => {
    expect(
      overtimeRuleFrom({ otEnabled: true, otThresholdMinutes: 3000, otMultiplierBps: 20000 }),
    ).toEqual({ enabled: true, weeklyThresholdMinutes: 3000, multiplierBps: 20000 });
  });
});

describe("formatMinutes", () => {
  it("formats hours and zero-padded minutes", () => {
    expect(formatMinutes(0)).toBe("0h 00m");
    expect(formatMinutes(5)).toBe("0h 05m");
    expect(formatMinutes(125)).toBe("2h 05m");
  });

  it("guards non-finite/negative", () => {
    expect(formatMinutes(-5)).toBe("0h 00m");
    expect(formatMinutes(NaN)).toBe("0h 00m");
  });
});
