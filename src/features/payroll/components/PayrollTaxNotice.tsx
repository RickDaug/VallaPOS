import { Info } from "lucide-react";

/**
 * The tax-withholding boundary, surfaced in the UI (see docs/PAYROLL.md). VallaPOS
 * records gross / adjustments / net and exports the run — it deliberately does NOT
 * compute statutory tax withholding, FICA, or filings.
 */
export function PayrollTaxNotice() {
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
