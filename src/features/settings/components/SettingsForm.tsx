"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessSettings } from "@/features/settings/actions";
import { TIMEZONE_OPTIONS, type TimezoneValue } from "@/features/settings/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

const CURRENCIES = ["USD", "MXN", "BRL", "CAD", "EUR", "GBP", "AUD"] as const;
type Currency = (typeof CURRENCIES)[number];
type Mode = "STORE" | "RESTAURANT";

export function SettingsForm({
  businessId,
  initial,
}: {
  businessId: string;
  initial: {
    name: string;
    taxRateBps: number;
    currency: string;
    timezone: string;
    taxInclusive: boolean;
    mode: Mode;
    singleOperatorMode: boolean;
    qrPayEnabled: boolean;
    qrPayLabel: string | null;
    qrPayValue: string | null;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [taxPercent, setTaxPercent] = useState((initial.taxRateBps / 100).toString());
  const [currency, setCurrency] = useState<Currency>(
    (CURRENCIES as readonly string[]).includes(initial.currency) ? (initial.currency as Currency) : "USD",
  );
  const [timezone, setTimezone] = useState<TimezoneValue>(
    TIMEZONE_OPTIONS.some((t) => t.value === initial.timezone)
      ? (initial.timezone as TimezoneValue)
      : "America/New_York",
  );
  const [taxInclusive, setTaxInclusive] = useState(initial.taxInclusive);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [singleOperatorMode, setSingleOperatorMode] = useState(initial.singleOperatorMode);
  const [qrPayEnabled, setQrPayEnabled] = useState(initial.qrPayEnabled);
  const [qrPayLabel, setQrPayLabel] = useState(initial.qrPayLabel ?? "");
  const [qrPayValue, setQrPayValue] = useState(initial.qrPayValue ?? "");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const taxRateBps = Math.round(parseFloat(taxPercent || "0") * 100);
    if (!Number.isFinite(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
      toast({ title: "Enter a tax rate between 0 and 100%.", variant: "error" });
      return;
    }
    if (qrPayEnabled && !qrPayValue.trim()) {
      toast({ title: "Add a QR payment value before enabling QR payments.", variant: "error" });
      return;
    }
    startTransition(async () => {
      try {
        await updateBusinessSettings({
          businessId,
          name: name.trim(),
          taxRateBps,
          currency,
          timezone,
          taxInclusive,
          mode,
          singleOperatorMode,
          qrPayEnabled,
          qrPayLabel: qrPayLabel.trim(),
          qrPayValue: qrPayValue.trim(),
        });
        toast({ title: "Settings saved", variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not save settings",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
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

          <div>
            <Label>Business type</Label>
            <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Business type">
              {(
                [
                  { value: "STORE", title: "Store", blurb: "Ring up and pay instantly." },
                  { value: "RESTAURANT", title: "Restaurant", blurb: "Tables, open tabs & split checks." },
                ] as const
              ).map((opt) => {
                const selected = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMode(opt.value)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-input bg-card hover:bg-muted"
                    }`}
                  >
                    <span className="block font-semibold text-foreground">{opt.title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{opt.blurb}</span>
                  </button>
                );
              })}
            </div>
            {mode === "RESTAURANT" && (
              <p className="mt-2 text-sm text-muted-foreground">
                A <span className="font-medium text-foreground">Floor</span> tab appears in the menu, and you can lay
                out your dining room below.
              </p>
            )}
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

          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value as TimezoneValue)}
              className="h-12 w-full rounded-md border border-input bg-card px-4 text-base text-foreground shadow-sm focus-visible:border-ring"
            >
              {TIMEZONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-muted-foreground">
              Sets your business day for reports and the time shown on receipts and order history.
            </p>
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

          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
            <span>
              <span className="block font-medium text-foreground">Stay unlocked (single operator)</span>
              <span className="text-sm text-muted-foreground">
                Don&apos;t re-lock the register after each sale — best for one person selling from one
                device. Leave off for a shared till so staff sign in per shift.
              </span>
            </span>
            <input
              type="checkbox"
              checked={singleOperatorMode}
              onChange={(e) => setSingleOperatorMode(e.target.checked)}
              className="h-5 w-5 accent-primary"
              aria-label="Stay unlocked (single operator mode)"
            />
          </label>

          <div className="rounded-lg border border-border p-4">
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium text-foreground">QR payment</span>
                <span className="text-sm text-muted-foreground">
                  Show a QR for the customer to scan and pay (PIX, UPI, Venmo, PayPal.me, a
                  payment link…). Recorded as a confirmed sale — no card data is stored.
                </span>
              </span>
              <input
                type="checkbox"
                checked={qrPayEnabled}
                onChange={(e) => setQrPayEnabled(e.target.checked)}
                className="h-5 w-5 accent-primary"
                aria-label="Enable QR payments"
              />
            </label>

            {qrPayEnabled && (
              <div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]">
                <div>
                  <Label htmlFor="qr-label">Label</Label>
                  <Input
                    id="qr-label"
                    value={qrPayLabel}
                    onChange={(e) => setQrPayLabel(e.target.value)}
                    placeholder="PIX"
                    maxLength={40}
                  />
                </div>
                <div>
                  <Label htmlFor="qr-value">Payment value (encoded in the QR)</Label>
                  <Input
                    id="qr-value"
                    value={qrPayValue}
                    onChange={(e) => setQrPayValue(e.target.value)}
                    placeholder="https://venmo.com/u/yourname  ·  a PIX key  ·  upi://…"
                    maxLength={512}
                  />
                </div>
              </div>
            )}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
