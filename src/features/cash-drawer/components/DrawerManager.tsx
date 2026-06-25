"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openDrawer, closeDrawer, type CloseDrawerResult } from "@/features/cash-drawer/actions";
import { reconcile, varianceKind } from "@/features/cash-drawer/reconcile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

/** Parse a dollars string ("12.34") into integer cents; null if invalid/negative. */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function VarianceBadge({ varianceCents }: { varianceCents: number }) {
  const kind = varianceKind(varianceCents);
  if (kind === "EXACT") return <Badge variant="success">Balanced</Badge>;
  const variant = kind === "OVER" ? "warning" : "destructive";
  const label = kind === "OVER" ? "Over" : "Short";
  return <Badge variant={variant}>{label}</Badge>;
}

export function OpenDrawerForm({
  businessId,
  money,
}: {
  businessId: string;
  money: (c: number) => string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [float, setFloat] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const openingFloatCents = dollarsToCents(float);
    if (openingFloatCents === null) {
      setError("Enter a valid opening float (0 or more).");
      return;
    }
    startTransition(async () => {
      try {
        await openDrawer({ businessId, openingFloatCents });
        toast({
          title: "Drawer opened",
          description: `Opening float ${money(openingFloatCents)}.`,
          variant: "success",
        });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't open the drawer",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <Card className="max-w-md">
      <CardContent className="p-5 md:p-6">
        <h2 className="text-lg font-bold">Open the drawer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Count the starting cash (opening float) and open the drawer to begin the shift.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <Label htmlFor="float">Opening float</Label>
            <Input
              id="float"
              inputMode="decimal"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              placeholder="100.00"
              className="numeric"
              autoFocus
            />
            {dollarsToCents(float) !== null && (
              <p className="numeric mt-1 text-sm text-muted-foreground">
                {money(dollarsToCents(float)!)}
              </p>
            )}
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Opening…" : "Open drawer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function CloseDrawerForm({
  businessId,
  sessionId,
  openingFloatCents,
  runningExpectedCents,
  canReconcile,
  money,
}: {
  businessId: string;
  sessionId: string;
  openingFloatCents: number;
  runningExpectedCents: number;
  canReconcile: boolean;
  money: (c: number) => string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseDrawerResult | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const countedCents = dollarsToCents(counted);
    if (countedCents === null) {
      setError("Enter the counted cash (0 or more).");
      return;
    }
    startTransition(async () => {
      try {
        const res = await closeDrawer({ businessId, sessionId, countedCents });
        setResult(res);
        const kind = varianceKind(res.varianceCents);
        toast({
          title: "Drawer closed",
          description:
            kind === "EXACT"
              ? "Counted cash balanced exactly."
              : kind === "OVER"
                ? `Over by ${money(Math.abs(res.varianceCents))}.`
                : `Short by ${money(Math.abs(res.varianceCents))}.`,
          variant: kind === "EXACT" ? "success" : "default",
        });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't close the drawer",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "error",
        });
      }
    });
  }

  if (result) {
    const kind = varianceKind(result.varianceCents);
    const magnitude = money(Math.abs(result.varianceCents));
    return (
      <Card
        className={`max-w-md transition-shadow ${
          kind === "EXACT" ? "border-success/40 shadow-sm" : ""
        }`}
      >
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Drawer closed</h2>
            <VarianceBadge varianceCents={result.varianceCents} />
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Expected" value={money(result.expectedCents)} />
            <Row label="Counted" value={money(result.countedCents)} />
            <div className="border-t border-border pt-2">
              <Row
                label="Variance"
                value={
                  kind === "EXACT"
                    ? money(0)
                    : kind === "OVER"
                      ? `+${magnitude} over`
                      : `−${magnitude} short`
                }
                strong
              />
            </div>
          </dl>
        </CardContent>
      </Card>
    );
  }

  if (!canReconcile) {
    return (
      <Card className="max-w-md">
        <CardContent className="p-5 text-sm text-muted-foreground">
          Only a manager or owner can count down and close the drawer.
        </CardContent>
      </Card>
    );
  }

  // Live preview so the operator can sanity-check before committing the count.
  const previewCents = dollarsToCents(counted);
  const preview =
    previewCents !== null
      ? reconcile(openingFloatCents, runningExpectedCents - openingFloatCents, previewCents)
      : null;

  return (
    <Card className="max-w-md">
      <CardContent className="p-5 md:p-6">
        <h2 className="text-lg font-bold">Close &amp; reconcile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Count the cash in the drawer and enter the total. Blind count: the expected figure is
          revealed only after you commit the count.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <Label htmlFor="counted">Counted cash</Label>
            <Input
              id="counted"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
              className="numeric"
              autoFocus
            />
            {preview && (
              <p className="numeric mt-1 text-sm text-muted-foreground">
                Counting {money(preview.countedCents)}
              </p>
            )}
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} variant="success">
            {pending ? "Closing…" : "Close drawer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`numeric ${strong ? "font-black" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
