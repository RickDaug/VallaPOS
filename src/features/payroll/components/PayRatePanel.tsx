"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPayRate } from "@/features/payroll/actions";
import type { PayRateRow } from "@/features/payroll/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

/** Dollars string → integer cents; null if blank/invalid/negative. */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "1.5" → 15000 bps; null if blank; NaN-guarded. */
function multiplierToBps(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10_000);
}

/** "40" (hours) → 2400 minutes; null if blank. */
function hoursToMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 60);
}

function centsToDollars(cents: number): string {
  return cents > 0 ? (cents / 100).toFixed(2) : "";
}

function PayRateRowEditor({ businessId, row }: { businessId: string; row: PayRateRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [payType, setPayType] = useState<"HOURLY" | "SALARY">(row.payType);
  const [hourly, setHourly] = useState(centsToDollars(row.hourlyCents));
  const [annual, setAnnual] = useState(centsToDollars(row.annualCents));
  const [otEnabled, setOtEnabled] = useState(row.otEnabled);
  const [otThreshold, setOtThreshold] = useState(
    row.otThresholdMinutes != null ? String(row.otThresholdMinutes / 60) : "",
  );
  const [otMultiplier, setOtMultiplier] = useState(
    row.otMultiplierBps != null ? String(row.otMultiplierBps / 10_000) : "",
  );
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    setError(null);
    const hourlyCents = payType === "HOURLY" ? dollarsToCents(hourly) : 0;
    const annualCents = payType === "SALARY" ? dollarsToCents(annual) : 0;
    if (payType === "HOURLY" && (hourlyCents === null || hourlyCents <= 0)) {
      setError("Enter an hourly rate.");
      return;
    }
    if (payType === "SALARY" && (annualCents === null || annualCents <= 0)) {
      setError("Enter an annual salary.");
      return;
    }
    startTransition(async () => {
      try {
        await setPayRate({
          businessId,
          membershipId: row.membershipId,
          payType,
          hourlyCents: hourlyCents ?? 0,
          annualCents: annualCents ?? 0,
          otEnabled,
          otThresholdMinutes: hoursToMinutes(otThreshold),
          otMultiplierBps: multiplierToBps(otMultiplier),
        });
        toast({ title: "Pay rate saved", description: row.name, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't save the pay rate",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.role}</p>
          </div>
          <div className="flex items-center gap-2">
            {!row.active && <Badge variant="warning">Inactive</Badge>}
            {row.hasRate ? (
              <Badge variant="success">Rate set</Badge>
            ) : (
              <Badge variant="warning">No rate</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor={`type-${row.membershipId}`}>Pay type</Label>
            <select
              id={`type-${row.membershipId}`}
              value={payType}
              onChange={(e) => setPayType(e.target.value as "HOURLY" | "SALARY")}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="HOURLY">Hourly</option>
              <option value="SALARY">Salary</option>
            </select>
          </div>

          {payType === "HOURLY" ? (
            <div>
              <Label htmlFor={`hourly-${row.membershipId}`}>Rate / hour</Label>
              <Input
                id={`hourly-${row.membershipId}`}
                inputMode="decimal"
                value={hourly}
                onChange={(e) => setHourly(e.target.value)}
                placeholder="15.00"
                className="numeric w-32"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor={`annual-${row.membershipId}`}>Annual salary</Label>
              <Input
                id={`annual-${row.membershipId}`}
                inputMode="decimal"
                value={annual}
                onChange={(e) => setAnnual(e.target.value)}
                placeholder="52000.00"
                className="numeric w-36"
              />
            </div>
          )}
        </div>

        {payType === "HOURLY" && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={otEnabled}
                onChange={(e) => setOtEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              Overtime
            </label>
            {otEnabled && (
              <>
                <div>
                  <Label htmlFor={`otthr-${row.membershipId}`}>OT after (hrs/week)</Label>
                  <Input
                    id={`otthr-${row.membershipId}`}
                    inputMode="decimal"
                    value={otThreshold}
                    onChange={(e) => setOtThreshold(e.target.value)}
                    placeholder="40"
                    className="numeric w-24"
                  />
                </div>
                <div>
                  <Label htmlFor={`otmul-${row.membershipId}`}>OT multiplier</Label>
                  <Input
                    id={`otmul-${row.membershipId}`}
                    inputMode="decimal"
                    value={otMultiplier}
                    onChange={(e) => setOtMultiplier(e.target.value)}
                    placeholder="1.5"
                    className="numeric w-24"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="button" onClick={onSave} disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save rate"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Pay-rate editing panel — one editor per member. manage_payroll gated upstream. */
export function PayRatePanel({ businessId, rows }: { businessId: string; rows: PayRateRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No team members yet. Add staff on the Team screen, then set their pay rates here.
      </p>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <PayRateRowEditor key={row.membershipId} businessId={businessId} row={row} />
      ))}
    </div>
  );
}
