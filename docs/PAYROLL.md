# Payroll (v1)

VallaPOS Payroll turns **clocked hours** (`TimeEntry`) + **pay rates** into
reviewable, exportable **pay runs**. It computes gross pay, applies manual
adjustments, and produces a net figure and a CSV export.

> ## ⚠ Hard boundary: no tax withholding
>
> VallaPOS Payroll **records gross / adjustments / net and exports a pay run** for
> the business to hand to their accountant or payroll provider. It **deliberately
> does NOT compute statutory tax withholding, FICA, or any government filing.**
> Payroll tax is regulated, jurisdiction-specific, and error-prone; getting it
> subtly wrong creates real legal/financial liability. So `net` here means
> **`gross + additions − deductions`, NOT take-home pay after withholding.**
>
> This boundary is surfaced in the UI (`PayrollTaxNotice`, shown on every payroll
> screen and in the CSV header) and enforced by scope — there is no withholding
> code to go wrong.

## Money model

- **All money is integer cents** (`src/lib/money.ts` convention). No floats.
- **Hourly rate** = cents per hour (`PayRate.hourlyCents`, e.g. `1500` = $15.00/hr).
- **Salary** = cents per year (`PayRate.annualCents`, e.g. `5_200_000` = $52,000/yr).
- **Overtime multiplier** = basis points (`otMultiplierBps`, `15000` = 1.5×,
  `10000` = 1.0×).
- Money components (regular pay, overtime pay) are each **rounded to a whole cent
  (standard half-up)** and then summed, so a stored `grossCents` is always exactly
  the sum of its stored parts — it can't drift.

## Data model (`prisma/schema.prisma`)

All models are **tenant-owned** (carry `businessId`, indexed, cascade-deleted with
the business) and are covered by the tenant-isolation CI guard.

| Model | Purpose |
| --- | --- |
| `PayRate` | One pay-rate config per worker (`Membership`). `payType` HOURLY/SALARY, `hourlyCents`/`annualCents`, per-worker overtime config (`otEnabled`, `otThresholdMinutes`, `otMultiplierBps`). Unique on `membershipId`. |
| `PayPeriod` | A pay run over `[startDate, endDate)` (half-open UTC window). `status` DRAFT → FINALIZED → PAID. |
| `Payslip` | One per worker per period (`@@unique([payPeriodId, membershipId])`). **Snapshots** the hours split (regular/overtime minutes), rate, and all money at compute time. |
| `PayslipAdjustment` | A manual line on a payslip. `kind` ADDITION (bonus/reimbursement) or DEDUCTION (advance repayment/employer deduction). `amountCents` is always **positive**; the sign in net comes from `kind`. |

The migration is **additive** (`prisma/migrations/…_payroll/`) — new enums,
tables, indexes, and FKs only; nothing existing is altered.

## Calculation (`src/features/payroll/calc.ts`)

A **pure module** (no `server-only`/Prisma) — the correctness core — with a
thorough test suite (`calc.test.ts`). Key decisions:

### Hours from intervals

- Each `TimeEntry` interval is **clipped to the pay-period window** `[start, end)`.
- An **open shift** (`clockOutAt === null`) is measured to `asOf` (the compute
  instant), so in-progress hours still count. The payslip records
  `openShiftCount` and the UI warns to clock out + recompute for final numbers.
- **Overlapping shifts are merged** (union) before counting, so a minute two
  shifts both cover is **never double-paid**. Zero-length / clock-skew (negative)
  spans are dropped.

### Overtime rule

- **Configurable, weekly.** Minutes over a **weekly threshold** (default `2400` =
  **40h**) are overtime, paid at `hourlyCents × multiplierBps / 10000` (default
  **1.5×**). Thresholds/multipliers are per-worker (`PayRate`), falling back to the
  defaults.
- A **"workweek" is a fixed 7-day block anchored at the pay-period start**
  (week 0 = `[start, start+7d)`, …). This is deterministic and timezone-independent.
  It is **not** the FLSA fixed-calendar-weekday workweek — documented as a v1
  simplification.
- Overtime is applied **per week** (30h + 30h across two weeks → no OT; 41h in one
  week → 40h regular + 1h OT). OT at **exactly** the threshold is 0.
- **Salaried workers are never overtime-eligible**; their hours are recorded for
  reference but don't affect pay.

### Salary proration

- `gross = annualCents × periodDays / 365`, rounded to the cent. A **fixed 365-day
  year** keeps proration deterministic (leap years are not specially handled).

### Net

- `netCents = grossCents + Σ additions − Σ deductions`.
- **Not clamped at zero** — a deduction (e.g. advance repayment) that exceeds gross
  produces a visible negative net rather than silently hiding the shortfall.

## Reads / writes / gating

- **Reads** — `src/features/payroll/queries.ts` (`server-only`): `listPayRates`,
  `listPayPeriods`, `getPayPeriodDetail`. Every query is scoped by `businessId`.
- **Writes** — `src/features/payroll/actions.ts` (`"use server"`, zod-validated,
  `manage_payroll`-gated via `requireCapability`): `setPayRate`, `createPayPeriod`,
  `computePayPeriod`, `finalizePayPeriod`, `reopenPayPeriod`, `markPayPeriodPaid`,
  `deletePayPeriod`, `addAdjustment`, `removeAdjustment`.
- **Capability** — `manage_payroll` (`src/lib/capabilities.ts`), in the OWNER +
  MANAGER default presets (CASHIER excluded). Existing MANAGER members created
  before this feature need a one-time permissions re-save to pick up the new
  capability (OWNER is always all-access).

### Pay-run lifecycle

```
DRAFT ──finalize──> FINALIZED ──mark paid──> PAID
  ↑                     │
  └──── reopen ─────────┘
```

- **Compute / recompute** (DRAFT only) pulls hours from `TimeEntry` for every
  **active worker with a pay rate** and upserts their payslip. **Recompute
  preserves manual adjustment lines** — only hours/gross are recalculated; net
  re-sums the kept adjustments. Workers with no pay rate are skipped.
- **Adjustments** can be added/removed only while the period is **DRAFT** (reopen a
  finalized run to edit). Each edit re-sums the payslip's net.
- **Finalize** locks the run for review/export and requires ≥1 payslip.
- **Delete** is allowed on **DRAFT** only.

## CSV export

- `GET /[businessId]/payroll/export?period=<id>` — `manage_payroll`-gated CSV
  download of a pay run: one row per worker (regular/OT hours, regular/OT pay,
  gross, additions, deductions, net) plus a totals row.
- Built by the pure `src/features/payroll/report.ts` (`buildPayrollCsv`), which
  **reuses the app's hardened RFC-4180 CSV helpers** from
  `src/features/orders/report-aggregate.ts` (`csvField`, `centsToAmount`) and
  **sanitizes user-controlled text cells** (worker names) against CSV formula
  injection (`sanitizeTextCell`). Amount cells stay raw decimals so a spreadsheet
  can sum them. The CSV header carries the tax-withholding boundary notice.

## What v1 does NOT do (future work)

- No tax withholding / FICA / filings (the hard boundary — by design).
- No pay-rate history (one active rate per worker; changing it doesn't version).
- No scheduled/automatic pay periods, direct deposit, or payslip delivery to
  workers.
- The workweek is anchored to the period start, not a fixed calendar weekday.
