import { Info } from "lucide-react";

/**
 * The tax-withholding boundary, surfaced in the UI (see docs/PAYROLL.md,
 * docs/PAYROLL_TAX.md).
 *
 * DEFAULT (`enabled` omitted/false): payroll v1 — VallaPOS records gross /
 * adjustments / net and exports the run; it does NOT compute withholding. This is
 * byte-for-byte the original copy so every existing screen is unchanged.
 *
 * When `enabled` is true (the provider withholding path is on for this business),
 * the copy instead reflects that the embedded payroll provider computes tax/net,
 * files, and remits — VallaPOS still just computes hours + gross and orchestrates.
 */
export function PayrollTaxNotice({ enabled = false }: { enabled?: boolean } = {}) {
  if (enabled) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <Info size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground">
            Tax withholding is computed by your payroll provider.
          </span>{" "}
          VallaPOS computes hours and gross pay and orchestrates the run; the embedded payroll
          provider computes employee/employer tax and net, and files and remits. You are the
          employer of record.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
      <Info size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">
        <span className="font-semibold text-foreground">No tax withholding is calculated.</span>{" "}
        VallaPOS records gross pay, adjustments, and net, and exports the pay run as a CSV. Hand the
        export to your accountant or payroll provider to compute tax withholding, FICA, and filings.
      </p>
    </div>
  );
}
