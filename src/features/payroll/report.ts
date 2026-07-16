/**
 * Pure pay-run CSV serialization (no `server-only` — unit-testable). Reuses the
 * RFC-4180 CSV helpers + formula-injection sanitizer from the orders report so
 * the whole app has ONE hardened CSV writer. Amounts are plain decimals so a
 * spreadsheet can sum them; worker names (user-controlled) are sanitized.
 *
 * The export deliberately carries a TAX-WITHHOLDING BOUNDARY notice: these are
 * GROSS / adjustment / NET figures, NOT take-home after statutory withholding.
 */

import { csvField, sanitizeTextCell, centsToAmount } from "@/features/orders/report-aggregate";

export interface PayrollCsvSlip {
  nameSnapshot: string;
  payType: string; // "HOURLY" | "SALARY"
  regularMinutes: number;
  overtimeMinutes: number;
  regularPayCents: number;
  overtimePayCents: number;
  grossCents: number;
  additionsCents: number;
  deductionsCents: number;
  netCents: number;
}

export interface PayrollCsvInput {
  periodLabel: string;
  currency: string;
  status: string;
  slips: PayrollCsvSlip[];
}

/** Whole minutes → decimal hours string (e.g. 90 → "1.50"), for spreadsheet math. */
export function minutesToHours(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  return (safe / 60).toFixed(2);
}

const TAX_NOTICE =
  "Gross/adjustments/net only — NO tax withholding, FICA, or filings are computed. " +
  "Hand this to your accountant or payroll provider.";

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(",");
}

/**
 * Serialize a pay run to a multi-section CSV (CRLF, RFC-4180). One row per
 * worker payslip plus a totals row. Hours are decimal; money is plain decimals.
 */
export function buildPayrollCsv(input: PayrollCsvInput): string {
  const amt = centsToAmount;
  const totals = input.slips.reduce(
    (acc, s) => ({
      regularPayCents: acc.regularPayCents + s.regularPayCents,
      overtimePayCents: acc.overtimePayCents + s.overtimePayCents,
      grossCents: acc.grossCents + s.grossCents,
      additionsCents: acc.additionsCents + s.additionsCents,
      deductionsCents: acc.deductionsCents + s.deductionsCents,
      netCents: acc.netCents + s.netCents,
    }),
    {
      regularPayCents: 0,
      overtimePayCents: 0,
      grossCents: 0,
      additionsCents: 0,
      deductionsCents: 0,
      netCents: 0,
    },
  );

  const rows: (string | number)[][] = [
    ["VallaPOS pay run", input.periodLabel],
    ["Status", input.status],
    [`Amounts in ${input.currency}`],
    [sanitizeTextCell(TAX_NOTICE)],
    [],
    [
      "Worker",
      "Pay type",
      "Regular hours",
      "Overtime hours",
      "Regular pay",
      "Overtime pay",
      "Gross",
      "Additions",
      "Deductions",
      "Net",
    ],
    ...input.slips.map((s) => [
      sanitizeTextCell(s.nameSnapshot),
      s.payType,
      minutesToHours(s.regularMinutes),
      minutesToHours(s.overtimeMinutes),
      amt(s.regularPayCents),
      amt(s.overtimePayCents),
      amt(s.grossCents),
      amt(s.additionsCents),
      amt(s.deductionsCents),
      amt(s.netCents),
    ]),
    [],
    [
      "Total",
      "",
      "",
      "",
      amt(totals.regularPayCents),
      amt(totals.overtimePayCents),
      amt(totals.grossCents),
      amt(totals.additionsCents),
      amt(totals.deductionsCents),
      amt(totals.netCents),
    ],
  ];

  return rows.map(csvRow).join("\r\n");
}
