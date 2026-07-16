"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  computePayPeriod,
  finalizePayPeriod,
  reopenPayPeriod,
  markPayPeriodPaid,
  deletePayPeriod,
  addAdjustment,
  removeAdjustment,
} from "@/features/payroll/actions";
import type { AdjustmentRow } from "@/features/payroll/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Status = "DRAFT" | "FINALIZED" | "PAID";

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Status-driven workflow controls for a pay period + the CSV export link. */
export function PeriodActions({
  businessId,
  periodId,
  status,
  hasPayslips,
}: {
  businessId: string;
  periodId: string;
  status: Status;
  hasPayslips: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>, success: string, after?: () => void) {
    startTransition(async () => {
      try {
        await fn();
        toast({ title: success, variant: "success" });
        if (after) after();
        else router.refresh();
      } catch (err) {
        toast({
          title: "Action failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => computePayPeriod({ businessId, payPeriodId: periodId }), "Payslips computed")
          }
        >
          {hasPayslips ? "Recompute from hours" : "Compute payslips"}
        </Button>
      )}
      {status === "DRAFT" && hasPayslips && (
        <Button
          type="button"
          variant="success"
          disabled={pending}
          onClick={() =>
            run(() => finalizePayPeriod({ businessId, payPeriodId: periodId }), "Pay period finalized")
          }
        >
          Finalize
        </Button>
      )}
      {status === "FINALIZED" && (
        <>
          <Button
            type="button"
            variant="success"
            disabled={pending}
            onClick={() =>
              run(
                () => markPayPeriodPaid({ businessId, payPeriodId: periodId }),
                "Marked as paid",
              )
            }
          >
            Mark paid
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => reopenPayPeriod({ businessId, payPeriodId: periodId }), "Reopened for editing")
            }
          >
            Reopen
          </Button>
        </>
      )}
      {hasPayslips && (
        <a
          href={`/${businessId}/payroll/export?period=${periodId}`}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-muted"
        >
          Export CSV
        </a>
      )}
      {status === "DRAFT" && (
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({
              title: "Delete this pay period?",
              description: "This removes the draft and its computed payslips. This can't be undone.",
              confirmLabel: "Delete",
            });
            if (ok) {
              run(
                () => deletePayPeriod({ businessId, payPeriodId: periodId }),
                "Pay period deleted",
                () => router.push(`/${businessId}/payroll`),
              );
            }
          }}
        >
          Delete
        </Button>
      )}
      {confirmDialog}
    </div>
  );
}

/**
 * Add/remove manual adjustment lines on a payslip (bonuses/reimbursements as
 * additions; advances/deductions as subtractions). Editable only while the parent
 * period is DRAFT.
 */
export function AdjustmentEditor({
  businessId,
  payslipId,
  adjustments,
  editable,
  money,
}: {
  businessId: string;
  payslipId: string;
  adjustments: AdjustmentRow[];
  editable: boolean;
  money: (c: number) => string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"ADDITION" | "DEDUCTION">("ADDITION");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onAdd() {
    setError(null);
    const amountCents = dollarsToCents(amount);
    if (!label.trim()) {
      setError("Enter a label.");
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    startTransition(async () => {
      try {
        await addAdjustment({ businessId, payslipId, kind, label: label.trim(), amountCents });
        setLabel("");
        setAmount("");
        toast({ title: "Adjustment added", variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't add the adjustment",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  function onRemove(adjustmentId: string) {
    startTransition(async () => {
      try {
        await removeAdjustment({ businessId, adjustmentId });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't remove the adjustment",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-2">
      {adjustments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {adjustments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground">
                  {a.kind === "ADDITION" ? "+ " : "− "}
                </span>
                {a.label}
              </span>
              <span className="flex items-center gap-2">
                <span className="numeric font-semibold">
                  {a.kind === "ADDITION" ? "+" : "−"}
                  {money(a.amountCents)}
                </span>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${a.label}`}
                    onClick={() => onRemove(a.id)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <div>
            <Label htmlFor={`kind-${payslipId}`} className="sr-only">
              Type
            </Label>
            <select
              id={`kind-${payslipId}`}
              value={kind}
              onChange={(e) => setKind(e.target.value as "ADDITION" | "DEDUCTION")}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="ADDITION">Addition</option>
              <option value="DEDUCTION">Deduction</option>
            </select>
          </div>
          <Input
            aria-label="Adjustment label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Bonus"
            maxLength={80}
            className="h-10 w-32"
          />
          <Input
            aria-label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="numeric h-10 w-24"
          />
          <Button type="button" variant="outline" onClick={onAdd} disabled={pending} className="h-10">
            Add
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
