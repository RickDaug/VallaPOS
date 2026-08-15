"use client";

/**
 * Pay-period tax controls (Beta): run a provider tax PREVIEW (computes per-worker
 * withholding + net and mirrors them onto the payslips) and APPROVE the run. Only
 * rendered when the provider withholding path is active for the business
 * (docs/PAYROLL_TAX.md). Never touches the pre-tax v1 figures.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  previewPayrollTaxRun,
  approvePayrollTaxRun,
} from "@/features/payroll/tax/actions";

export function PayrollTaxRunControls({
  businessId,
  periodId,
  hasPreview,
}: {
  businessId: string;
  periodId: string;
  /** True once a provider preview has run (a checkPayrollId exists). */
  hasPreview: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function preview() {
    startTransition(async () => {
      try {
        const result = await previewPayrollTaxRun({ businessId, payPeriodId: periodId });
        if (!result.ok) {
          toast({ title: "Couldn't run tax preview", description: result.reason, variant: "error" });
          return;
        }
        toast({
          title: "Tax preview computed",
          description:
            result.skipped > 0
              ? `${result.written} worker(s) withheld · ${result.skipped} not synced to provider`
              : `${result.written} worker(s) withheld`,
          variant: "success",
        });
        router.refresh();
      } catch {
        toast({ title: "Couldn't run tax preview", variant: "error" });
      }
    });
  }

  function approve() {
    startTransition(async () => {
      try {
        const result = await approvePayrollTaxRun({ businessId, payPeriodId: periodId });
        if (!result.ok) {
          toast({ title: "Couldn't approve run", description: result.reason, variant: "error" });
          return;
        }
        toast({ title: "Payroll run approved", variant: "success" });
        router.refresh();
      } catch {
        toast({ title: "Couldn't approve run", variant: "error" });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={preview} disabled={pending} className="gap-2">
        <Calculator className="size-4" aria-hidden />
        {hasPreview ? "Recompute tax preview" : "Run tax preview"}
      </Button>
      {hasPreview && (
        <Button type="button" variant="success" onClick={approve} disabled={pending} className="gap-2">
          <CheckCircle2 className="size-4" aria-hidden /> Approve run
        </Button>
      )}
    </div>
  );
}
