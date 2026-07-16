"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayPeriod } from "@/features/payroll/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

/** New pay-period form: a date range (+ optional label) → a DRAFT period. */
export function CreatePeriodForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) {
      setError("Choose a start and end date.");
      return;
    }
    if (startDate > endDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    startTransition(async () => {
      try {
        const { payPeriodId } = await createPayPeriod({
          businessId,
          label: label.trim() || undefined,
          startDate,
          endDate,
        });
        toast({ title: "Pay period created", variant: "success" });
        router.push(`/${businessId}/payroll/${payPeriodId}`);
      } catch (err) {
        toast({
          title: "Couldn't create the pay period",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="p-5 md:p-6">
        <h2 className="text-lg font-bold">New pay period</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the dates to pay for. Hours are pulled from clock-ins within the range.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <Label htmlFor="start">Start date</Label>
              <Input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <Label htmlFor="end">End date</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="label">Label (optional)</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="First half of July"
              maxLength={80}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create pay period"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
