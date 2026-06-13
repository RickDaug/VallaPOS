"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessSettings } from "@/features/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
type Currency = (typeof CURRENCIES)[number];

export function SettingsForm({
  businessId,
  initial,
}: {
  businessId: string;
  initial: { name: string; taxRateBps: number; currency: string; taxInclusive: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [taxPercent, setTaxPercent] = useState((initial.taxRateBps / 100).toString());
  const [currency, setCurrency] = useState<Currency>(
    (CURRENCIES as readonly string[]).includes(initial.currency) ? (initial.currency as Currency) : "USD",
  );
  const [taxInclusive, setTaxInclusive] = useState(initial.taxInclusive);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const taxRateBps = Math.round(parseFloat(taxPercent || "0") * 100);
    if (!Number.isFinite(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
      setMessage({ kind: "err", text: "Enter a tax rate between 0 and 100%." });
      return;
    }
    startTransition(async () => {
      try {
        await updateBusinessSettings({ businessId, name: name.trim(), taxRateBps, currency, taxInclusive });
        setMessage({ kind: "ok", text: "Settings saved." });
        router.refresh();
      } catch (err) {
        setMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not save." });
      }
    });
  }

  return (
    <Card className="max-w-lg">
      <CardContent className="p-5 md:p-6">
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <Label htmlFor="biz-name">Business name</Label>
            <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tax">Sales tax rate (%)</Label>
              <Input
                id="tax"
                inputMode="decimal"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                placeholder="8.25"
                className="numeric"
              />
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="h-12 w-full rounded-md border border-input bg-card px-4 text-base text-foreground shadow-sm focus-visible:border-ring"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
            <span>
              <span className="block font-medium text-foreground">Tax-inclusive pricing</span>
              <span className="text-sm text-muted-foreground">Prices already include tax (vs. added at checkout).</span>
            </span>
            <input
              type="checkbox"
              checked={taxInclusive}
              onChange={(e) => setTaxInclusive(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>

          {message && (
            <p
              className={`text-sm font-medium ${message.kind === "ok" ? "text-success" : "text-destructive"}`}
              role="status"
            >
              {message.text}
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
